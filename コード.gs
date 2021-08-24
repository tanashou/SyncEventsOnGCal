function main() {
  const referenceCalendarId = '参照するカレンダーID';
  const syncCalendarId = '同期するカレンダーID';
  const keyword = 'キーワード';
  const lineNotifyToken = 'LINE Notifyで取得したトークン'
  logSyncedEvents(referenceCalendarId, syncCalendarId, keyword, lineNotifyToken, false);
  judgeIfNeedsToRemoved(referenceCalendarId, syncCalendarId);
}

/**
 * Helper function to get a new Date object relative to the current date.
 * @param {number} daysOffset The number of days in the future for the new date.
 * @param {number} hour The hour of the day for the new date, in the time zone
 *     of the script.
 * @return {Date} The new date.
 */
function getRelativeDate(daysOffset, hour) {
  var date = new Date();
  date.setDate(date.getDate() + daysOffset);
  date.setHours(hour);
  date.setMinutes(0);
  date.setSeconds(0);
  date.setMilliseconds(0);
  return date;
}

function patchEvent(patchedEvent, patchingEvent, syncCalendarId, lineNotifyToken) {
  if(patchingEvent.summary == patchedEvent.summary &&
     patchingEvent.description == patchedEvent.description &&
     patchingEvent.start.dateTime == patchingEvent.start.dateTime &&
     patchingEvent.end.dateTime == patchingEvent.end.dateTime) {
       Logger.log("同一のイベントが存在しています。");
       return;
     }

  var resource = {
        summary: patchedEvent.summary,
        location: patchedEvent.location,
        description: patchedEvent.description,
        start: {
          dateTime: patchedEvent.start.dateTime
        },
        end: {
          dateTime: patchedEvent.end.dateTime
        }
      };

  try {
    // TODO
    let formerEvent = patchingEvent;
    let event = Calendar.Events.patch(resource, syncCalendarId, patchingEvent.id);
    sendLINENotificationWhenPatched(formerEvent, event, lineNotifyToken);
    Logger.log("イベントが更新されました。");
  } catch(error) {
    console.error(error);
  }
}

/**
 * @param {object} 参照するイベント
 * @param {string} 同期するカレンダーのID
 */
function insertEvent(event, syncCalendarId, lineNotifyToken) {
  var resource = {
    summary: event.summary,
    location: event.location,
    description: event.description,
    start: {
      date: event.start.date,
      dateTime: event.start.dateTime,
      timeZone: event.start.timeZone
    },
    end: {
      date: event.end.date,
      dateTime: event.end.dateTime,
      timeZone: event.end.timeZone
    }
  };

  event = Calendar.Events.insert(resource, syncCalendarId);
  Logger.log("イベントが追加されました。");
  console.log('%s (%s)', event.summary, event.start.dateTime.toLocaleString());
  sendLINENotificationWhenInserted(event, lineNotifyToken);
}

// このままではonedayイベントが削除できないが、必要ないはず
function removeEvent(formerEvent, syncCalendarId, syncCalEvents, lineNotifyToken) { // event:コピー元のイベント calendar API のeventsであることに注意
  try {
    // 条件に当てはまるイベントを１つだけ取り出す
    let removingEvent = syncCalEvents.items.find(Evt => Evt.summary == formerEvent.summary &&
                                                        Evt.description == formerEvent.description &&
                                                        Evt.start.dateTime == formerEvent.start.dateTime);

    if(removingEvent) {
      Calendar.Events.remove(syncCalendarId, removingEvent.id);
      Logger.log("イベントが削除されました。");
      sendLINENotificationWhenRemoved(removingEvent, lineNotifyToken);
    } else {
      Logger.log("削除するイベントがありませんでした。");
    }
  } catch(error) {
    console.error(error);
  }
}

function judgeIfNeedsToRemoved(referenceCalendarId ,syncCalendarId ,lineNotifyToken) {
  let options = {
    maxResults: 500,
    singleEvents: true,
    timeZone: "Asia/Tokyo",
    timeMin: getRelativeDate(-7, 0).toISOString(),
    timeMax: getRelativeDate(90, 0).toISOString()
  }
  let syncCalEvents = Calendar.Events.list(syncCalendarId, options);
  let referenceCalEvents = Calendar.Events.list(referenceCalendarId, options);

  if(syncCalEvents.items && syncCalEvents.items.length > 0) {
    for(var i = 0; i < syncCalEvents.items.length; i++) {
      var syncCalEvent = syncCalEvents.items[i];
      var event = referenceCalEvents.items.find(Evt => Evt.summary == syncCalEvent.summary &&
                                                       Evt.description == syncCalEvent.description &&
                                                       Evt.start.dateTime == syncCalEvent.start.dateTime &&
                                                       Evt.end.dateTime == syncCalEvent.end.dateTime)
      if(event == null) {
        try {
          Calendar.Events.remove(syncCalendarId, syncCalEvent.id);
          sendLINENotificationWhenRemoved(syncCalEvent, lineNotifyToken);
          Logger.log("必要のないイベントが削除されました。");
        } catch(error) {
          console.error(error);
        }
      }    
    }
  }
}

/**
 * Retrieve and log events from the given calendar that have been modified
 * since the last sync. If the sync token is missing or invalid, log all
 * events from up to a month ago (a full sync).
 *
 * @param {string} referenceCalendarId The ID of the calender to retrieve events from.
 * @param {boolean} fullSync If true, throw out any existing sync token and
 *        perform a full sync; if false, use the existing sync token if possible.
 */
function logSyncedEvents(referenceCalendarId, syncCalendarId, keyword, lineNotifyToken, fullSync) {
  var properties = PropertiesService.getUserProperties();
  var options = {
    maxResults: 500,
    singleEvents: true,
    timeZone: "Asia/Tokyo",
    showDeleted: true,
  };
  var syncToken = properties.getProperty('syncToken');
  if (syncToken && !fullSync) {
    options.syncToken = syncToken;
  } else {
    options.timeMin = getRelativeDate(-7, 0).toISOString();
    options.timeMax = getRelativeDate(90, 0).toISOString();
  }

  // Retrieve events one page at a time.
  var events;
  var syncCalEvents;
  var pageToken;
  var optionsForSyncCal = {
    maxResults: 500,
    singleEvents: true,
    timeZone: "Asia/Tokyo",
    timeMin: getRelativeDate(-7, 0).toISOString(),
    timeMax: getRelativeDate(90, 0).toISOString()
  }

  do {
    try {
      options.pageToken = pageToken;
      events = Calendar.Events.list(referenceCalendarId, options);
      syncCalEvents = Calendar.Events.list(syncCalendarId, optionsForSyncCal);
    } catch {
      Logger.log("full syncを行います。")
      // Check to see if the sync token was invalidated by the server;
      // if so, perform a full sync instead.  
      properties.deleteProperty('syncToken');
      logSyncedEvents(referenceCalendarId, true); // 初回実行時やsyncTokenの期限が切れた場合
      return;
    }

    let eventsItems = events.items.filter(Evt => Evt.description?.includes(keyword));

    if (eventsItems && eventsItems.length > 0) {
      for (var i = 0; i < eventsItems.length; i++) {
         var event = eventsItems[i];
         if (event.status === 'cancelled') {
           console.log('Event id %s was cancelled.', event.id);
           removeEvent(event, syncCalendarId, syncCalEvents, lineNotifyToken);
         } else {
           let patchingEvent = syncCalEvents.items.find(Evt => Evt.start.dateTime == event.start.dateTime &&
                                                               Evt.end.dateTime == event.end.dateTime);
           if(patchingEvent) {
             patchEvent(event, patchingEvent, syncCalendarId, lineNotifyToken);
           } else {
             insertEvent(event, syncCalendarId ,lineNotifyToken);
           }
         }
      }
    } else {
      console.log('No events found.');
    }

    pageToken = events.nextPageToken;
  } while (pageToken);

  properties.setProperty('syncToken', events.nextSyncToken);
}

function sendLINENotificationWhenInserted(event, lineNotifyToken) {
  let messageText = `
  イベントが追加されました。
  ${event.start.dateTime}
  タイトル: ${event.summary}
  場所: ${event.location}
  説明: ${event.description.replace('\n', ' ')}`
 
  // LINEから取得したトークン
  let token = lineNotifyToken;
  let options = {
    "method" : "post",
    "headers" : {
      "Authorization" : "Bearer "+ token
    },
    "payload" : {
      "message" : messageText
    }
  }

  let url  = "https://notify-api.line.me/api/notify"
  UrlFetchApp.fetch(url, options)
}

function sendLINENotificationWhenPatched(formerEvent, patchedEvent, lineNotifyToken) {
  let messageText = `
  イベントが更新されました。
  ${formerEvent.start.dateTime}
  タイトル: ${formerEvent.summary}
        → ${patchedEvent.summary}
  場所: ${formerEvent.location}
     → ${patchedEvent.location}
  説明: ${formerEvent.description.replace('\n', ' ')}
     → ${patchedEvent.description.replace('\n', ' ')}`
 
  // LINEから取得したトークン
  let token = lineNotifyToken;
  let options = {
    "method" : "post",
    "headers" : {
      "Authorization" : "Bearer "+ token
    },
    "payload" : {
      "message" : messageText
    }
  }

  let url  = "https://notify-api.line.me/api/notify"
  UrlFetchApp.fetch(url, options)
}

function sendLINENotificationWhenRemoved(event, lineNotifyToken) {
  let messageText = `
  イベントが削除されました。
  ${event.start.dateTime}
  タイトル: ${event.summary}
  場所: ${event.location}
  説明: ${event.description.replace('\n', ' ')}`
 
  // LINEから取得したトークン
  let token = lineNotifyToken;
  let options = {
    "method" : "post",
    "headers" : {
      "Authorization" : "Bearer "+ token
    },
    "payload" : {
      "message" : messageText
    }
  }

  let url  = "https://notify-api.line.me/api/notify"
  UrlFetchApp.fetch(url, options)
}