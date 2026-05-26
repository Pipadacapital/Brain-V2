/**
 * Notifications application barrel.
 *
 * v1 internal contract path: @brain/core-notifications
 * The gateway imports these use-cases in-process. core-service owns the logic.
 */

export {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationItem,
  type ListOptions,
} from './notifications-use-cases.js'
