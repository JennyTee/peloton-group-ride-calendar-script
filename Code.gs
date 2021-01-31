/* 
Peloton Group Ride Calendar Script
Version 1.0.3

Updates in this version: 
-Updated mmdd regex to accept backward slash as separator
*/

//Update these variables before running script:
const testMode = true;
const sendEmailNow = false;

// Do not update these variables
var groupCalendarId;
var emailForLogs;

if (testMode) {
  groupCalendarId = 'vlmi3d70cioq0ef0kgoouh91cg@group.calendar.google.com';
  emailForLogs = 'pelotontestcalendar@gmail.com';
} else {
  groupCalendarId ='fvjve3k2n5p7mu5c018vc4n80c@group.calendar.google.com';
  emailForLogs = 'onepeloton@gmail.com, pelotontestcalendar@gmail.com';
}

const classIdRegEx = /classId=[0-9a-f]{32}/i;
const liveIdRegEx = /liveId=[0-9a-f]{32}/i;
var instructorHashMap;
var existingPostIds = new Array();
var loggingEmailText = '';

function syncGroupRideCalendar() {
  getMetadataMappings();
  getGroupRides();

  // only send out email twice per day at ~6am and 6pm
  const now = new Date();
  if (sendEmailNow ||
    (now.getHours() == 6 && now.getMinutes() <= 10 && now.getMinutes() > 0) ||
    (now.getHours() == 18 && now.getMinutes() <= 10 && now.getMinutes() > 0)) {
      MailApp.sendEmail(emailForLogs, 'Group ride script execution log', loggingEmailText);
      Logger.log(`Script execution email sent to ${emailForLogs}.`);
  }
}

function createTrigger() {
  // Get Reddit posts every 10 minutes to avoid hitting Reddit and Google Apps Script quotas
  ScriptApp.newTrigger("syncGroupRideCalendar")
           .timeBased().everyMinutes(10).create();
  Logger.log('Trigger created.');
}

function getMetadataMappings() {
  const url = 'https://api.onepeloton.com/api/ride/metadata_mappings';
  let response = UrlFetchApp.fetch(url, {'muteHttpExceptions': true});
  let json = response.getContentText();
  let data = JSON.parse(json);

  let instructorList = data.instructors;
  instructorHashMap = new Map(instructorList.map(i => [i.id, i]));
}

function getGroupRides() {
  // Get 100 most-recent posts
  const subreddit = "pelotoncycle";
  const url = 'http://www.reddit.com/r/' + subreddit + '/new.json?limit=100';

  let response = UrlFetchApp.fetch(url, {'muteHttpExceptions': true});
  let json = response.getContentText();
  let data = JSON.parse(json);
  
  let posts = !!data.data ? data.data.children : null;
  if (!posts) {
    const logMessage = "Reddit's API did not return any r/pelotoncycle group posts. Script run aborted.";
    Logger.log(logMessage);
    loggingEmailText = loggingEmailText.concat(`\n${logMessage}`);
    return null;
  }

  let groupRidePosts = posts.filter(p => !!p.data.link_flair_text && p.data.link_flair_text.toLowerCase().includes('group'));
  existingPostIds = groupRidePosts.map(grp => grp.data.id);

  let liveGroupRidePosts = groupRidePosts.filter(grp => grp.data.selftext.match(liveIdRegEx));

  // Stacked group ride posts can potentially have live and on demand classes in them. We prioritize the live ones (above).
  // If there are also on demand rides, we do not handle these at this time.
  // If only on demand rides exist, the script will create an event for the first on demand ride.
  const toDelete = new Set(liveGroupRidePosts.map(p => p.data.id));
  const nonLiveGroupRidePosts = groupRidePosts.filter(obj => !toDelete.has(obj.data.id));

  let onDemandGroupRidePosts = nonLiveGroupRidePosts.filter(grp => grp.data.selftext.match(classIdRegEx));

  let postsWithoutClassIdOrLiveId = nonLiveGroupRidePosts.filter(grp => !grp.data.selftext.match(classIdRegEx));

  if (!!postsWithoutClassIdOrLiveId) {
    postsWithoutClassIdOrLiveId.forEach( p => {
      const logMessage = `${p.data.title}\n${p.data.url}\nEVENT CREATION FAILED: Reddit post missing link with ClassId/LiveId.`;
      Logger.log(logMessage); 
      loggingEmailText = loggingEmailText.concat(`${logMessage}\n\n`);
    })
  }

  let existingLiveRideEvents = getUpcomingEvents('primary');
  let existingGroupRideEvents = getUpcomingEvents(groupCalendarId);

  let unmatchedLiveRidePosts = handleLiveRidePosts(liveGroupRidePosts, existingLiveRideEvents, existingGroupRideEvents);
  let success = handleOnDemandPosts(onDemandGroupRidePosts, existingGroupRideEvents);

   handleDeletedPosts(existingPostIds);
}

function handleLiveRidePosts(liveGroupRidePosts, existingLiveRideEvents, existingGroupRideEvents) {
  let unmatchedLiveRidePosts = new Array();

  for (let i = 0; i < liveGroupRidePosts.length; i++) {
    let post = liveGroupRidePosts[i].data;
    const logMessagePostInfo = `Live ride post: ${post.title}\n${post.url}`;
    Logger.log(logMessagePostInfo);
    loggingEmailText = loggingEmailText.concat(`${logMessagePostInfo}\n`);

    let title = post.title.replace(/\s/g,'');
    const liveIdString = post.selftext.match(liveIdRegEx);
    if (!liveIdString) {
      const logMessage = `EVENT CREATION FAILED: ride post did not include LiveId. \nPost text: ${post.selftext}\n`;
      Logger.log(logMessage); 
      loggingEmailText = loggingEmailText.concat(`${logMessage}\n\n`);
      continue;
    }
    
    const liveId = liveIdString[0].split('=')[1];
    let matchingEvent = existingLiveRideEvents.get(liveId);
    if (!matchingEvent) {
      // if there isn't a matching event, either it has already passed or there's something wrong with the liveId
      // make call to Peloton API to see if ride has passed
      const rideComplete = isLiveRideComplete(liveId);
      let logMessage = '';
      if (rideComplete) {
        logMessage = `No action needed: ride start date/time has already passed.`;
      } else {
        logMessage = `EVENT CREATION FAILED: no matching live ride found in live ride calendar. ${post.url} \nLiveId provided: ${liveId}`;
      }
      Logger.log(logMessage); 
      loggingEmailText = loggingEmailText.concat(`${logMessage}\n\n`);
      unmatchedLiveRidePosts.push(post);
      continue;
    }
    if (existingGroupRideEvents.has(liveId)) {
      const logMessage = `No action needed: group ride calendar event already exists.\nRide start time: ${matchingEvent.getStart().getDateTime()}`;
      Logger.log(logMessage); 
      loggingEmailText = loggingEmailText.concat(`${logMessage}\n\n`);
      continue;
    }
    
    // if event summary doesn't have [Encore] in it, then it's a live ride. This is a dependency on the live ride calendar script.
    if (!matchingEvent.summary.includes('[Encore]')) {
      matchingEvent.summary = matchingEvent.summary.concat(' [Live]');
    }

    // add group ride post information to event description
    matchingEvent.description = buildEventDescription(matchingEvent.description, post, false);

    // update location so reddit group ride sidebar works
    let classType = '';
    let extendedProperties = matchingEvent.getExtendedProperties()
      if (extendedProperties) {
        let sharedExtendedProperties = extendedProperties.getShared();
        if (!!sharedExtendedProperties && sharedExtendedProperties.classType != null) {
          classType = sharedExtendedProperties.classType;
        } 
      }

    matchingEvent.location = getLocation(post.id, liveId, true, classType);

    // If an event with same eventId was already created & deleted, inserting the same event again will fail. Clearing out the below ids avoids that issue.
    matchingEvent.id = '';
    matchingEvent.iCalUID = '';
    Calendar.Events.insert(matchingEvent, groupCalendarId);
    const logMessage = `Success: Live ride calendar event copied to group calendar.\nRide start time: ${matchingEvent.getStart().getDateTime()}`;
    Logger.log(logMessage); 
    loggingEmailText = loggingEmailText.concat(`${logMessage}\n\n`);
  }
  
  return unmatchedLiveRidePosts;
}

function isLiveRideComplete(liveId) {
  const url = `https://api.onepeloton.com/api/peloton/${liveId}`;
  let response = UrlFetchApp.fetch(url, {'muteHttpExceptions': true});
  let json = response.getContentText();
  let data = JSON.parse(json);

  // Added check for scheduled_start_time b/c sometimes a ride that is completed actually has is_complete == false. Not sure why.
  // Example: https://api.onepeloton.com/api/peloton/a8436ddabb414f5b95eef6a853a2ebb7
  if (!!data && (data.is_complete || (!!data.scheduled_start_time && data.scheduled_start_time < new Date()))) {
    return true;
  } 

  return false;
}

function handleOnDemandPosts(onDemandGroupRidePosts, existingGroupRideEvents) {  
  for (let i = 0; i < onDemandGroupRidePosts.length; i++) {
    let post = onDemandGroupRidePosts[i].data;
    loggingEmailText = loggingEmailText.concat(`On Demand ride post: ${post.title} ${post.url}\n`);

    let title = post.title.replace(/\s/g,'');
    const rideDateTime = getGroupRideDateTime(title);
    const classIdString = post.selftext.match(classIdRegEx);
    if (!classIdString) {
      const logMessage = `EVENT CREATION FAILED: On Demand ride post did not include ClassId.\nPost title: ${title}\nPost text: ${post.selftext}`;
      Logger.log(logMessage); 
      loggingEmailText = loggingEmailText.concat(`${logMessage}\n\n`);
      continue;
    }
    
    const classId = classIdString[0].split('=')[1];
    if (!rideDateTime || !classId) {
      continue;
    } 
      
    if (existingGroupRideEvents.has(classId)) {
      const logMessage = `No action needed: group ride calendar event already exists.\nRide start time: ${rideDateTime}`;
      Logger.log(logMessage); 
      loggingEmailText = loggingEmailText.concat(`${logMessage}\n\n`);
      continue;
    }
    
    let event = createOnDemandEvent(classId, rideDateTime, post);
    if (!!event) {
      const logMessage = `Success: On Demand ride calendar event created in group calendar.\nRide start time: ${rideDateTime}`;
      Logger.log(logMessage); 
      loggingEmailText = loggingEmailText.concat(`${logMessage}\n\n`);
    }
  }
}

function createOnDemandEvent(classId, startDateTime, post) {
  if (startDateTime < new Date()) {
    const logMessage = `No action needed: ride start date/time has already passed.\nRide start time: ${startDateTime}`;
    Logger.log(logMessage);
    loggingEmailText = loggingEmailText.concat(`${logMessage}\n\n`);
    return null;
  }

  let ride = getMatchingClassInfo(classId);
  let endTime = new Date(startDateTime.getTime() + (ride.duration * 1000));
  let summary = buildEventSummary(ride);
  let instructorName = getInstructorName(ride.instructor_id);
  let event = {
    summary: summary,
    location: getLocation(post.id, classId, false, ride.fitness_discipline),
    description: buildEventDescription(ride.description, post, true),
    start: {
      dateTime: startDateTime.toISOString()
    },
    end: {
      dateTime: endTime.toISOString()
    },
    colorId: 5,
    // Extended properties are not currently displayed in created calendar events. They are just metadata tags.
    extendedProperties: {
      shared: {
        classLength: ride.duration / 60,
        classId: ride.id,
        classType: ride.fitness_discipline_display_name,
        hasClosedCaptions: ride.has_closed_captions,
        instructor: getInstructorName(ride.instructor_id),
        metadataId: classId,
        redditPostId: post.id
      }
    }
  };

  // Create event in main shared calendar
  event = Calendar.Events.insert(event, groupCalendarId);
  
  return event;
}

function getLocation(redditPostId, classOrLiveId, isLiveEvent, classType) {
  classType = classType.toLowerCase();

  // as of 1/2021, URLs are still using old format for bootcamp (now 'tread bootcamp' in API) and bike_bootcamp (now 'bike bootcamp in API) categories
  if (classType === 'bike bootcamp') {
    classType = 'bike_bootcamp';
  } else if (classType === 'tread bootcamp') {
    classType = 'bootcamp';
  }

  const groupThread = `[Group Thread](https://old.reddit.com/r/pelotoncycle/comments/${redditPostId}/)`;
  let classLink = '';
  if (isLiveEvent) {
    classLink = `[Class Link](https://members.onepeloton.com/schedule/${classType}?modal=scheduledClassDetails&liveId=${classOrLiveId})`;
  } else {
    classLink = `[Class Link](https://members.onepeloton.com/classes/${classType}?modal=classDetailsModal&classId=${classOrLiveId})`;
  }
  return `${groupThread} & ${classLink}`;
}

function getMatchingClassInfo(classId) {
  const url = `https://api.onepeloton.com/api/ride/${classId}/details`;
  let response = UrlFetchApp.fetch(url, {'muteHttpExceptions': true});
  let json = response.getContentText();
  let data = JSON.parse(json);

  return !!data ? data.ride : null;
}

function getInstructorName(instructorId) {
  let instructor = instructorHashMap.get(instructorId);
  if (!!instructor) {
    if (!!instructor.last_name) {
      return `${instructor.first_name} ${instructor.last_name}`;
    } else {
    return `${instructor.first_name}`;
    }
  }
  return '';
}

function buildEventDescription(pelotonRideDescription, redditPost, includeComplimentsOf) {
  const separator = '------------------------------------------------------------------------';
  const complimentsOf = '\n\nCompliments of the largest global Peloton community at https://www.reddit.com/r/pelotoncycle';
  const description = `Peloton ride description:\n${pelotonRideDescription}${includeComplimentsOf ? complimentsOf : ''}\n${separator}\nRide thread:\n` +
    `${redditPost.url}\n${separator}\nRide thread text:\n${redditPost.title}\n\n${redditPost.selftext}`
  return description;
}

function buildEventSummary(ride) {
  let foreignLanguageIndicator = '';
  // If rides are offered in other languages someday, this will need to be updated.
  if (ride.origin_locale == 'de-DE') {
    foreignLanguageIndicator = ' [German]';
  }
  const onDemandIndicator = ' [On Demand]';
  const eventSummary = `${ride.title}${foreignLanguageIndicator}${onDemandIndicator}`;
  return eventSummary;
}

function getGroupRideDateTime(title) {
  const mmddRegEx = /((1[012]|[1-9]|0[1-9]|)[- \/\\.](3[01]|[12][0-9]|[1-9]|0[1-9])([- \/\\.](20[23][0-9]|[23][0-9]))?)/;
  const monthDateRegEx = /(((Jan)|(January)|(Feb)|(February)|(Mar)|(March)|(Apr)|(April)|(May)|(Jun)|(June)|(Aug)|(August)|(Sep)|(Sept)|(September)|(Oct)|(October)|(Nov)|(November)|(Dec)|(December))\.?(3[01]|[12][0-9]|[1-9])s?t?n?r?d?h?,?(20[23][0-9]|[23][0-9])?)/;
  const mmdd = title.match(mmddRegEx);
  const monthDate = title.match(monthDateRegEx);
  let month = 0;
  let date = 0;
  let year = 0;
  let now = new Date();
  
  // The RegEx already validated these values as integers, so no need to double check before calling parseInt
  if (!!mmdd && mmdd.length >= 5) {
    month = parseInt(mmdd[2], 10);
    date = parseInt(mmdd[3], 10);
    
    // If no year provided:
    if (!mmdd[5] || mmdd[5].length == 0) {
      if (now.getMonth() > 10 && month < 2) {
        // assume following year if it's currently Nov/Dec and the provided month is Jan or Feb
        year = now.getFullYear() + 1;
      } else {
        // otherwise assume current year
        year = now.getFullYear();
      }
    } else {
      // Note: only works for 20xx years
      year = parseInt((mmdd[5].length == 4 ? mmdd[5] : ('20' + mmdd[5].slice(0,2))), 10);
    }
  } else if (!!monthDate) {
    // Can add this in the future, if desired. For now, not supporting written-out day format.
    // month should be at index 2; date should be at index 26
    // if used, monthDate regex currently fails if comma or "st" ending on date not provided 
    // e.g., Jan 1st 2020 is ok but Jan 1 2020 is not.
    const logMessage = 'EVENT CREATION FAILED: post title did not use mm/dd/yyyy format.';
    Logger.log(logMessage); 
    loggingEmailText = loggingEmailText.concat(`${logMessage}\n\n`);
    return null;
  } else {
    const logMessage = `EVENT CREATION FAILED: could not parse date from post title.`;
    Logger.log(logMessage); 
    loggingEmailText = loggingEmailText.concat(`${logMessage}\n\n`);
    return null;
  }
  
  let rideTime = getGroupRideTime(title);
  if (!rideTime) {
    return null;
  }
  let rideDateTime = new Date(year, month - 1, date, rideTime[0], rideTime[1], 0);
  return rideDateTime;
}

function getGroupRideTime(title) {
  const groupRideTimeRegEx = /(([1-9]|1[012])[:.]([0-5][0-9])|([1-9]|1[012]))([pa]m)([pmce][sd]t|[pmce]t)/i;
  let hour = 0;
  let minutes = 0;
  let timeZone = '';
  
  let timeString = title.match(groupRideTimeRegEx);
  if (!timeString || timeString.length < 7) {
    const logMessage = `EVENT CREATION FAILED: could not parse time from post title.`;
    Logger.log(logMessage); 
    loggingEmailText = loggingEmailText.concat(`${logMessage}\n\n`);
    return null;
  }
  
  const isPM = timeString[5].toLowerCase() === 'pm';
  if (!!timeString[2] && !!timeString[3]) {
    // Time provided as hh:mm or h:mm
    hour = isPM ? (parseInt(timeString[2], 10) + 12) : parseInt(timeString[2], 10);
    minutes = parseInt(timeString[3], 10);
  } else if (!!timeString[4]) {
     // Time provided as hh or h
    hour = isPM ? (parseInt(timeString[4], 10) + 12) : parseInt(timeString[4], 10);
  } else {
    const logMessage = `EVENT CREATION FAILED: could not parse time from post title.`;
    Logger.log(logMessage); 
    loggingEmailText = loggingEmailText.concat(`${logMessage}\n\n`);
    return null;
  }
    
  timeZone = timeString[6].toLowerCase();
  
  // This script assumes the group ride calendar is defaulted to use Eastern Time.
  let easternTimeArray = convertToEasternTime(hour, minutes, timeZone);
  return easternTimeArray;
}

function convertToEasternTime(hour, minutes, timeZone) {
  if (timeZone === 'est' || timeZone === 'et' || timeZone === 'edt') {
    return new Array(hour, minutes);
  } else if (timeZone === 'cst' || timeZone === 'ct' || timeZone === 'cdt') {
    return new Array(hour + 1, minutes);
  } else if (timeZone === 'mst' || timeZone === 'mt' || timeZone === 'mdt') {
    return new Array(hour + 2, minutes);
  } else if (timeZone === 'pst' || timeZone === 'pt' || timeZone === 'pdt') {
    return new Array(hour + 3, minutes);
  } else {
    const logMessage = `EVENT CREATION FAILED: could not convert to Eastern time.\nHour: ${hour}, Minutes: ${minutes}, Time Zone: ${timeZone}`;
    Logger.log(logMessage); 
    loggingEmailText = loggingEmailText.concat(`${logMessage}\n\n`);
    return null;
  }
}

function getUpcomingEvents(calendarId) {
  let existingEvents = new Map();
  let now = new Date();
  
  // Pulls event from primary calendar associated with Google account from which this script is run
  let events = Calendar.Events.list(calendarId, {
    timeMin: now.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 500
  });
  if (events.items && events.items.length > 0) {
    for (let i = 0; i < events.items.length; i++) {
      let event = events.items[i];
      let extendedProperties = event.getExtendedProperties()
      if (!extendedProperties) { 
        continue;
      }
      let sharedExtendedProperties = extendedProperties.getShared();
      if (!!sharedExtendedProperties && sharedExtendedProperties.metadataId != null) {
        existingEvents.set(sharedExtendedProperties.metadataId, event);
      }
    }
  }
  return existingEvents;
}

function handleDeletedPosts(existingPostIds) {
  let existingEvents = getUpcomingEventMap();

  if (existingEvents.size < 1) {
    return null;
  }

  // The below code is needed because we're only getting the 100 most-recent posts from the Reddit API, so we need
  // an extra check to see if the event didn't show up because 1) it was posted prior to the 100th post or 
  // 2) because it was deleted (which is important to support in case someone makes a typo in the post title)

  // Check all upcoming events. If postId matches existingPostId, it's in the 100 posts we just got
  // and is therefore a valid post. If postId not in list, hit the post URL to see if it returns anything.
  // if not, delete the event.

  for (const [key, value] of existingEvents) {
    let redditPostId = key;
    const getRedditPostURL = `https://www.reddit.com/by_id/t3_${redditPostId}/.json`;
    let response = UrlFetchApp.fetch(getRedditPostURL, {'muteHttpExceptions': true});
    let json = response.getContentText();
    let data = JSON.parse(json);

    if (!!data && !!data.data && !!data.data.children) {
      continue;
    } else {
      deleteEventById(value.getId());
    }
  }
}

// returns map of redditPostId: googleCalendarEvent
function getUpcomingEventMap() {
  let existingEvents = new Map();
  let now = new Date();
  let events = Calendar.Events.list(groupCalendarId, {
    timeMin: now.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 500
  });
  if (events.items && events.items.length > 0) {
    for (let i = 0; i < events.items.length; i++) {
      let event = events.items[i];
      let extendedProperties = event.getExtendedProperties()
      if (!extendedProperties) { 
        continue;
      }
      let sharedExtendedProperties = extendedProperties.getShared();
      if (!!sharedExtendedProperties && sharedExtendedProperties.redditPostId != null) {
        existingEvents.set(sharedExtendedProperties.redditPostId, event);
      }
    }
  }
  return existingEvents;
}

function deleteEventById(eventId) {
  try {
    let event = CalendarApp.getCalendarById(groupCalendarId).getEventById(eventId);

    var title = event.getTitle();
    // Delete shared calendar event
    event.deleteEvent();
    const logMessage = `Event deleted: ${title}`;
    Logger.log(logMessage); 
    loggingEmailText = loggingEmailText.concat(`${logMessage}\n\n`);

  } catch(e) {
    const logMessage = `Error deleting event related to post: ${title}. Error message: {e}`;
    Logger.log(logMessage); 
    loggingEmailText = loggingEmailText.concat(`${logMessage}\n\n`);
  }
}
