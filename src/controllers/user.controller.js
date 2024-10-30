import {asyncHandler} from "../utils/asyncHandler.js"
import {apiError} from "../utils/apiError.js"
import { User } from "../models/user.model.js"
import {uploadOnCloudinary} from "../utils/cloudinary.js"
import { apiResponse } from "../utils/apiResponse.js"
import jwt from "jsonwebtoken"

const generateAccessAndRefreshTokens = async (userId) => {
    try {
        const user = await User.findById(userId)
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()

        user.refreshToken = refreshToken
        await user.save({validateBeforeSave: false})

        return {accessToken, refreshToken}
    } catch (error) {
        throw new apiError(500, "Something went wrong while generating tokens!")
    }
}

const registerUser = asyncHandler(async (req, res) => {
    // Get user details from frontend
    const {fullname, email, username, password} = req.body
    
    // Data Validation
    if(
        [fullname, email, username, password].some((field) => field?.trim() === "")
    ){
        throw new apiError(400, "All fields are compulsory")
    }

    // Check for existing User
    const existingUser = await User.findOne({
        $or: [{username}, {email}]
    })

    if(existingUser){
        throw new apiError(409, "User with same email or username already exists!")
    }

    // Check for Cover images and avatar
    const avatarLocalPath = req.files?.avatar[0]?.path;
    let coverImageLocalPath;

    if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0){
        coverImageLocalPath  = req.files?.coverImage[0]?.path;
    }

    if(!avatarLocalPath){
        throw new apiError(400, "Avatar file is required")
    }

    // Upload them to cloudinary
    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if(!avatar){
        throw new apiError(400, "Avatar file is required")
    }

    // Create new object and do entry in db
    const user = await User.create({
        fullname,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email,
        password,
        username: username.toLowerCase()
    })

    // Remove password and refresh tokens
    const userCreated = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    if(!userCreated){
        throw new apiError(500, 'Something went wrong while registering the user!')
    }

    // Return response
    return res.status(201).json(
        new apiResponse(200, userCreated, "User registered successfully")
    )
})

const loginUser = asyncHandler(async (req,res) => {
    // Get user details
    const {email, username, password} = req.body
    
    if(!username && !email){
        throw new apiError(400, "Username or Email is required");
    }

    // Find the user 
    const user = await User.findOne({
        $or: [{username}, {email}]
    })

    if(!user){
        throw new apiError(404, "User does not exist!")
    }

    // Password Check
    const validPass = await user.isPasswordCorrect(password);

    if(!validPass){
        throw new apiError(401, "Invalid user credentials")
    }

    // Access and Refresh Token
    const {accessToken, refreshToken} = await generateAccessAndRefreshTokens(user._id)

    // Send cookies
    const loggednInUser = await User.findById(user._id).select("-password -refreshToken")

    const options = {
        httpOnly: true,
        secure: true
    }

    return res.status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
        new apiResponse(
            200,
            {
                user: loggednInUser, accessToken, refreshToken
            },
            "User logged in successfully"
        )
    )
})

const logoutUser = asyncHandler(async(req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refreshToken: undefined
            }
        },
        {
            new: true
        }
    )

    const options = {
        httpOnly: true,
        secure: true
    }

    return res.status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new apiResponse(200, {}, "User logged out"))
})

const refreshAccessToken = asyncHandler(async (req,res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

    if(!incomingRefreshToken){
        throw new apiError(401, "Unauthorized Request")
    }

    try {
        const decodedToken = jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET
        )
    
        const user = await User.findById(decodedToken?._id)
        if(!user){
            throw new apiError(401, "Invalid Refresh Token")
        }
    
        if(incomingRefreshToken !== user?.refreshToken){
            throw new apiError(401, "Refresh Token is expired or used")
        }
    
        const options = {
            httpOnly: true,
            secure: true
        }
    
        const {accessToken, newRefreshToken} = await generateAccessAndRefreshTokens(user._id)
    
        return res.status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", newRefreshToken, options)
        .json(
            new apiResponse(
                200,
                {accessToken, refreshToken: newRefreshToken},
                "Access token refreshed"
            )
        )
    } catch (error) {
        throw new apiError(401, error?.message || "Invalid refresh token")
    }
})

const changeCurrentPassword = asyncHandler(async (req,res) => {
    const {oldPassword, newPassword} = req.body
    const user = await User.findById(req.user?._id)

    const passCorrect = await user.isPasswordCorrect(oldPassword)

    if(!passCorrect){
        throw new apiError(400, "Invalid Old Password")
    }

    user.password = newPassword
    await user.save({validateBeforeSave: false})

    return res.status(200)
    .json(
        new apiResponse(200, {}, "Password Updated Successfully")
    )
})

const getCurrentUser = asyncHandler(async (req,res) => {
    return res.status(200).json(new apiResponse(200, req.user, "Current user fetched successfully"))
})

const updateAccountDetails = asyncHandler(async (req,res) => {
    const {fullname, email} = req.body

    if(!fullname && !email){
        throw new apiError(400, "All fields are required")
    }

    const user = await User.findByIdAndUpdate(
        req.body?._id,
        {
            $set: {
                fullname,
                email
            }
        },
        {
            new: true
        }
    ).select("-password")

    return res.status(200)
    .json(new apiResponse(200, user, "Details updated successfully"))
})

const updateUserAvatar = asyncHandler(async (req, res) => {
    const avatarLocalPath = req.file?.path
    if(!avatarLocalPath){
        throw new apiError(400, "Avatar file is missing")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)
    if(!avatar){
        throw new apiError(400, "Error while uploading avatar")
    }

    const user = await User.findByIdAndUpdate(req.user?._id, 
        {
            $set: {
                avatar: avatar.url
            }
        },
        {
            new: true
        }
    ).select("-password")

    return res.status(200)
    .json(
        new apiResponse(200, user, "Avatar updated successfully")
    )
})

const updateUserCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalPath = req.file?.path
    if(!coverImageLocalPath){
        throw new apiError(400, "Cover image file is missing")
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath)
    if(!coverImage){
        throw new apiError(400, "Error while uploading cover image")
    }

    const user = await User.findByIdAndUpdate(req.user?._id, 
        {
            $set: {
                coverImage: coverImage.url
            }
        },
        {
            new: true
        }
    ).select("-password")

    return res.status(200)
    .json(
        new apiResponse(200, user, "Cover image updated successfully")
    )
})

export {
    registerUser, 
    loginUser, 
    logoutUser, 
    refreshAccessToken, 
    changeCurrentPassword, 
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCoverImage
}