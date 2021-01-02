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
  const groupRideDateRegEx = /([1-9]|0[1-9]|1[012])[- \/.]([1-9]|0[1-9]|[12][0-9]|3[01])[- \/.](20[23][0-9]|[23][0-9])\|/;
  const groupRideTimeRegEx = /(([1-9]|1[012])[:.]([1-5][0-9])|([1-9]|1[012]))[pa]m([pmce][sd]t|[pmce]t)/i;
  
  let groupRidePosts = posts.filter(p => !!p.data.link_flair_text && p.data.link_flair_text.includes(':groupride'));
  let onDemandGroupRidePosts = groupRidePosts.filter(grp => grp.data.selftext.match(classIdRegEx));
  let liveGroupRidePosts = groupRidePosts.filter(grp => grp.data.selftext.match(liveIdRegEx));
  
  // TODO: For on demand group rides, create new calendar event
  
  for (let i = 0; i < onDemandGroupRidePosts.length; i++) {
    let title = onDemandGroupRidePosts[i].data.title.replace(/\s/g,'');
    const rideDate = title.match(groupRideDateRegEx);
    const rideTime = title.match(groupRideTimeRegEx);
    if (!!rideTime && !!rideDate) {
      console.log(`ride date: ${rideDate[0]}, ride time: ${rideTime[0]}`);
    } else {
      console.log(`parsing error for: ${!!rideDate ? '' : 'rideDate '}${!!rideTime ? '' : 'rideTime '}`);
    }
  }
  
  // TODO: For live/encore group rides, copy existing live ride calendar event to group ride calendar
  
  
}

