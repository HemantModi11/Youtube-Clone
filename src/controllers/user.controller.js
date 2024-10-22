import {asyncHandler} from "../utils/asyncHandler.js"
import {apiError} from "../utils/apiError.js"
import { User } from "../models/user.model.js"
import {uploadOnCloudinary} from "../utils/cloudinary.js"
import { apiResponse } from "../utils/apiResponse.js"

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

export {registerUser}