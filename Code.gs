//Update these variables before running script:
var groupCalendarId = 'vlmi3d70cioq0ef0kgoouh91cg@group.calendar.google.com';

function run() {
  // Get Reddit posts every 5 minutes to avoid hitting Reddit and Google Apps Script quotas
  ScriptApp.newTrigger("getGroupRides")
           .timeBased().everyMinutes(5).create();
}

function getGroupRides() {

  // Get 100 most-recent posts
  let subreddit = "pelotoncycle";
  let url = "http://www.reddit.com/r/" + subreddit + "/new.json?limit=100";

  let response = UrlFetchApp.fetch(url, {'muteHttpExceptions': true});
  let json = response.getContentText();
  let data = JSON.parse(json);
  
  let posts = !!data.data ? data.data.children : null;
  
  const classIdRegEx = /classId=[0-9a-f]{32}/i;
  const liveIdRegEx = /liveId=[0-9a-f]{32}/i;
  const groupRideTitleRegEx = /(.*?)\|(.*?)\|(.*?)\|(.*?)/;
  
  let groupRidePosts = posts.filter(p => !!p.data.link_flair_text && p.data.link_flair_text.includes(':groupride'));
  //TODO: check for post with groupride flair that don't match classId or liveId reg ex
  let onDemandGroupRidePosts = groupRidePosts.filter(grp => grp.data.selftext.match(classIdRegEx));
  let liveGroupRidePosts = groupRidePosts.filter(grp => grp.data.selftext.match(liveIdRegEx));
  
  // TODO: For on demand group rides, create new calendar event
  
  for (let i = 0; i < onDemandGroupRidePosts.length; i++) {
    let post = onDemandGroupRidePosts[i].data;
    let title = post.title.replace(/\s/g,'');
    const rideDateTime = getGroupRideDateTime(title);
    const classId = post.selftext.match(classIdRegEx);
    if (!!rideDateTime && classId) {
      Logger.log(title);
    } else {
      console.log(`parsing error for rideDateTime: ${rideDateTime}`);
      console.log(`post title: ${title}`);
    }
  }
  
  let existingLiveRideEvents = getUpcomingEvents('primary');
  let existingGroupRideEvents = getUpcomingEvents(groupCalendarId);
  
  // TODO: For live/encore group rides, copy existing live ride calendar event to group ride calendar
  for (let i = 0; i < liveGroupRidePosts.length; i++) {
    let post = liveGroupRidePosts[i].data;
    const liveIdString = post.selftext.match(liveIdRegEx);
    if (!liveIdString) {
      console.log(`ERROR: LIVE RIDE POST DID NOT INCLUDE LIVEID. Post text: ${post.selftext}`); 
      continue;
    }
    
    const liveId = liveIdString[0].split('=')[1];
    let matchingEvent = existingLiveRideEvents.get(liveId);
    let testEvent = existingLiveRideEvents.get('a7760e4535b94299846d4ef0143922c8');
    let testEvent2 = existingLiveRideEvents.get('c44580eae4b445f79a3a7242f7786315');
    if (!matchingEvent) {
      console.log(`NO MATCHING EVENT FOR LIVEID ${liveId}`);
      continue;
    }
    
    
    if (existingGroupRideEvents.has(liveId)) {
      console.log(`Group ride exists for classId ${matchingEvent.id}`);
      continue;
    }
    
    Calendar.Events.insert(matchingEvent, groupCalendarId);
    
  }
}

function getGroupRideDateTime(title) {
  const mmddRegEx = /(([1-9]|0[1-9]|1[012])[- \/.]([1-9]|0[1-9]|[12][0-9]|3[01])[- \/.](20[23][0-9]|[23][0-9]))/;
  const monthDateRegEx = /(((Jan)|(January)|(Feb)|(February)|(Mar)|(March)|(Apr)|(April)|(May)|(Jun)|(June)|(Aug)|(August)|(Sep)|(Sept)|(September)|(Oct)|(October)|(Nov)|(November)|(Dec)|(December))\.?([1-9]|[12][0-9]|3[01])s?t?n?r?d?h?,?(20[23][0-9]|[23][0-9])?)/;
  const mmdd = title.match(mmddRegEx);
  const monthDate = title.match(monthDateRegEx);
  let month = 0;
  let date = 0;
  let year = 0;
  
  if (!!mmdd && mmdd.length >= 5) {
    //todo - convert to timestamp. index 2 is month, 3 is date, and 4 is year
    month = parseInt(mmdd[2], 10);
    date = parseInt(mmdd[3], 10);
    // Note: only works for 20xx years
    year = parseInt((mmdd[4].length == 4 ? mmdd[4] : ('20' + mmdd[4].slice(0,2))), 10);
  } else if (!!monthDate) {
    //todo - convert to timestamp
  } else {
    Logger.log(`Could not parse date string from post title: ${title}`);
    return null;
  }
  
  let rideTime = getGroupRideTime(title);
  //let birthday = new Date(1995, 11, 17, 3, 24, 0)
  let rideDateTime = new Date(year, month, date, rideTime[0], rideTime[1], 0);
  return rideDateTime;
  
  const mmddyyyRegEx = /(([1-9]|0[1-9]|1[012])[- \/.]([1-9]|0[1-9]|[12][0-9]|3[01])[- \/.](20[23][0-9]|[23][0-9]))/
  const longFormRegEx = /(((Jan)|(January)|(Feb)|(February)|(Mar)|(March)|(Apr)|(April)|(May)|(Jun)|(June)|(Aug)|(August)|(Sep)|(Sept)|(September)|(Oct)|(October)|(Nov)|(November)|(Dec)|(December))\.?([1-9]|[12][0-9]|3[01])s?t?n?r?d?h?,?(20[23][0-9]|[23][0-9])?)/;
}

function getGroupRideTime(title) {
  const groupRideTimeRegEx = /(([1-9]|1[012])[:.]([0-5][0-9])|([1-9]|1[012]))([pa]m)([pmce][sd]t|[pmce]t)/i;
  let hour = 0;
  let minutes = 0;
  let timeZone = '';
  
  let timeString = title.match(groupRideTimeRegEx);
  if (!!timeString && timeString.length >= 7) {
    const isPM = timeString[5].toLowerCase() === 'pm';
    hour = isPM ? (parseInt(timeString[2], 10) + 12) : parseInt(timeString[2], 10);
    minutes = parseInt(timeString[3], 10);
    timeZone = timeString[6].toLowerCase();
  } else {
      Logger.log(`Could not parse time string from post title: ${title}`);
      return null;
  }
  
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
    Logger.log(`Could not convert to Eastern time. Hour: ${hour}, Minutes: ${minutes}, Time Zone: ${timeZone}`);
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
