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
    const rideDate = getGroupRideDate(title);
    const rideTime = getGroupRideTime(title);
    const classId = post.selftext.match(classIdRegEx);
    if (!!rideTime && !!rideDate && classId) {
      console.log(title);
      console.log(`ride date: ${rideDate}, ride time: ${rideTime}, classId: ${classId}`);
    } else {
      console.log(`parsing error for: ${!!rideDate ? '' : 'rideDate '}${!!rideTime ? '' : 'rideTime '}`);
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

function getGroupRideDate(title) {
  const groupRideDateRegEx = /(([1-9]|0[1-9]|1[012])[- \/.]([1-9]|0[1-9]|[12][0-9]|3[01])[- \/.](20[23][0-9]|[23][0-9]))|(((Jan)|(January)|(Feb)|(February)|(Mar)|(March)|(Apr)|(April)|(May)|(Jun)|(June)|(Aug)|(August)|(Sep)|(Sept)|(September)|(Oct)|(October)|(Nov)|(November)|(Dec)|(December))\.?([1-9]|[12][0-9]|3[01])s?t?n?r?d?h?,?(20[23][0-9]|[23][0-9])?)/;
  let dateString = title.match(groupRideDateRegEx);
  if (!dateString)
    return '';
  return dateString[0];
  const mmddyyyRegEx = /(([1-9]|0[1-9]|1[012])[- \/.]([1-9]|0[1-9]|[12][0-9]|3[01])[- \/.](20[23][0-9]|[23][0-9]))/
  const longFormRegEx = /(((Jan)|(January)|(Feb)|(February)|(Mar)|(March)|(Apr)|(April)|(May)|(Jun)|(June)|(Aug)|(August)|(Sep)|(Sept)|(September)|(Oct)|(October)|(Nov)|(November)|(Dec)|(December))\.?([1-9]|[12][0-9]|3[01])s?t?n?r?d?h?,?(20[23][0-9]|[23][0-9])?)/;
}

function getGroupRideTime(title) {
  const groupRideTimeRegEx = /(([1-9]|1[012])[:.]([0-5][0-9])|([1-9]|1[012]))[pa]m([pmce][sd]t|[pmce]t)/i;
  let timeString = title.match(groupRideTimeRegEx);
  if (!timeString)
    return '';
  return timeString[0];
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
