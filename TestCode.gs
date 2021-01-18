function createTestEventForDeletedPost() {
  let startTime = new Date(2021, 0, 20, 8, 0, 0);
  let endTime = new Date(2021, 0, 20, 8, 30, 0);
  let summary = 'test event for deleted post';
  let instructorName = 'test instructor name';
  let newEvent = {
    summary: summary,
    location: instructorName,
    description: 'test description',
    start: {
      dateTime: startTime.toISOString()
    },
    end: {
      dateTime: endTime.toISOString()
    },
    colorId: 4,
    // Extended properties are not currently displayed in created calendar events. They are just metadata tags.
    extendedProperties: {
      shared: {
        classLength: 30,
        classId: 'test classId',
        classType: 'test ride',
        hasClosedCaptions: false,
        instructor: 'test instructor',
        metadataId: 'test metadataId',
        redditPostId: 'test redditPostId'
      }
    }
  };

  // Create event in main shared calendar
  event = Calendar.Events.insert(newEvent, groupCalendarId);
  Logger.log('Test event created');
  
}

// Deletes all existing events in the group ride Google calendar.
// Only use if you really want to delete all existing events!
// You may have to run this more than once--it seems to time out if there are many items in the calendar.
function deleteAllFutureEvents() {
  let startDate = new Date();
  let events = Calendar.Events.list(groupCalendarId, {
    timeMin: startDate.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 1000
  });
  
  if (events.items && events.items.length > 0) {
    events.items.forEach(i => deleteEventById(i.id));
  }
}
