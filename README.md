# Peloton Group Workout Calendar Automation Script
This script provides automatic updates to a shared Google calendar when r/pelotoncycle users create a new thread tagged with #groupride.

### How it works:
 - Queries the Reddit API for recent r/pelotoncycle posts and looks for #groupride posts
 - Compares existing group workout calendar events with #groupride posts to see if new events need to be created
 - For live rides, copies the existing class event from the live ride calendar to the group ride calendar
 - For on demand rides, creates a new calendar event with the user-specified start date/time. Also makes a separate Peloton API request to get class details for that class ID.
 - Sends logging emails for monitoring of incorrect post title formatting and/or missing class links.
