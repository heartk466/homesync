const handleNotificationClick = async (notification) => {
  console.log("Notification clicked:", notification); // Debug log
  
  // Mark as read
  if (!notification.is_read) {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notification.id);
    if (onMarkAllRead) onMarkAllRead();
  }

  setShowNotifications(false);

  // Build the destination URL
  let destination = notification.link_path;
  
  // Add query parameters if they exist
  if (notification.link_query) {
    destination = `${notification.link_path}?${notification.link_query}`;
  }
  
  // Parse state
  let state = {};
  try {
    if (notification.link_state) state = JSON.parse(notification.link_state);
  } catch (e) {
    console.error("Failed to parse link_state:", e);
  }
  
  console.log("Navigating to:", destination, state); // Debug log
  
  // Navigate
  navigate(destination, { state });
};