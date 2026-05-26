/**
 * User-profile application barrel.
 *
 * v1 internal contract path: @brain/core-user-profile
 */

export {
  getProfile,
  updateProfile,
  deleteAccount,
  UserProfileError,
  type AccountProfile,
  type UpdateProfileInput,
} from './user-profile-use-cases.js'
