// ============================================================
// NASH & NELLIE WORKOUT HUB — Google Apps Script Backend
// ============================================================
// This script does two jobs:
//   1) One-time: restructures your sheet into 3 clean tabs
//   2) Ongoing: serves as a tiny API the touchscreen app calls
//      to read today's workouts and write back completions
// ============================================================

var LIBRARY_SHEET = 'Exercise Library';
var ASSIGNMENTS_SHEET = 'Daily Assignments';
var LOG_SHEET = 'Completion Log';
var KIDS = ['Nash', 'Nellie'];
var ASSIGNMENT_KID_OPTIONS = ['Nash', 'Nellie', 'Both'];
var CATEGORIES = ['Strength', 'Explosiveness', 'Quickness', 'Sports-Specific', 'Foundational'];
var RESULT_TYPES = ['None', 'Weight', 'Distance', 'Time'];

// ------------------------------------------------------------
// STEP 1 — Run this ONCE from the Apps Script editor
// (Select "setupSheetStructure" in the function dropdown, click Run)
// Only for a from-scratch setup — this CLEARS existing tabs.
// ------------------------------------------------------------
function setupSheetStructure() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- Exercise Library ---
  var lib = ss.getSheetByName(LIBRARY_SHEET) || ss.insertSheet(LIBRARY_SHEET);
  lib.clear();
  lib.getRange(1, 1, 1, 4).setValues([['Exercise Name', 'YouTube Link', 'Category', 'Result Type']]);
  lib.getRange(1, 1, 1, 4).setFontWeight('bold');
  lib.getRange(2, 3, 500, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(CATEGORIES, true).build()
  );
  lib.getRange(2, 4, 500, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(RESULT_TYPES, true).build()
  );
  lib.setColumnWidths(1, 4, 200);

  // --- Daily Assignments ---
  // "Done"/"Result" columns are per-kid (not a single shared column) because
  // a "Both" row still needs Nash and Nellie tracked independently.
  var asg = ss.getSheetByName(ASSIGNMENTS_SHEET) || ss.insertSheet(ASSIGNMENTS_SHEET);
  asg.clear();
  var asgHeaders = ['Date', 'Kid', 'Exercise Name', 'Sets', 'Reps', 'Nash Done', 'Nash Result', 'Nellie Done', 'Nellie Result'];
  asg.getRange(1, 1, 1, asgHeaders.length).setValues([asgHeaders]);
  asg.getRange(1, 1, 1, asgHeaders.length).setFontWeight('bold');
  asg.getRange(2, 2, 1000, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ASSIGNMENT_KID_OPTIONS, true).build()
  );
  asg.getRange(2, 3, 1000, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(lib.getRange('A2:A500'), true).build()
  );
  asg.getRange(2, 6, 1000, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  asg.getRange(2, 8, 1000, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  asg.setColumnWidths(1, asgHeaders.length, 130);

  // --- Completion Log (the app writes here — don't hand-edit) ---
  var log = ss.getSheetByName(LOG_SHEET) || ss.insertSheet(LOG_SHEET);
  log.clear();
  log.getRange(1, 1, 1, 6).setValues([['Date', 'Kid', 'Exercise Name', 'Done', 'Result Value', 'Completed At']]);
  log.getRange(1, 1, 1, 6).setFontWeight('bold');
  log.setColumnWidths(1, 6, 150);

  SpreadsheetApp.getUi().alert(
    'Setup complete!\n\nNext: fill in the "Exercise Library" tab with your exercises, ' +
    'YouTube links, categories, and result types. Then use "Daily Assignments" each day ' +
    'to pick what Nash and Nellie are doing.'
  );
}

// ------------------------------------------------------------
// Run this ONCE to add "Both" to the existing Kid dropdown
// without touching any data you already have.
// ------------------------------------------------------------
function addBothToKidDropdown() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var asg = ss.getSheetByName(ASSIGNMENTS_SHEET);
  asg.getRange(2, 2, 1000, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ASSIGNMENT_KID_OPTIONS, true).build()
  );
  SpreadsheetApp.getUi().alert('Done! "Both" is now a valid option in the Daily Assignments Kid column.');
}

// ------------------------------------------------------------
// Run this ONCE to add live "Done"/"Result" tracking columns
// directly onto Daily Assignments, without touching existing rows.
// ------------------------------------------------------------
function addDoneResultColumnsToAssignments() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var asg = ss.getSheetByName(ASSIGNMENTS_SHEET);
  var lastCol = asg.getLastColumn();
  var headers = asg.getRange(1, 1, 1, lastCol).getValues()[0];

  var newHeaders = ['Nash Done', 'Nash Result', 'Nellie Done', 'Nellie Result'];
  var toAdd = newHeaders.filter(function (h) { return headers.indexOf(h) === -1; });
  if (toAdd.length === 0) {
    SpreadsheetApp.getUi().alert('Those columns already exist — nothing to do.');
    return;
  }

  var startCol = lastCol + 1;
  asg.getRange(1, startCol, 1, toAdd.length).setValues([toAdd]);
  asg.getRange(1, startCol, 1, toAdd.length).setFontWeight('bold');
  asg.setColumnWidths(startCol, toAdd.length, 130);

  toAdd.forEach(function (h, idx) {
    if (h.indexOf('Done') > -1) {
      asg.getRange(2, startCol + idx, 1000, 1).setDataValidation(
        SpreadsheetApp.newDataValidation().requireCheckbox().build()
      );
    }
  });

  SpreadsheetApp.getUi().alert(
    'Added ' + toAdd.join(', ') + ' to Daily Assignments.\n\n' +
    'These checkboxes are now the live completion status — the app reads and writes them directly, ' +
    'and you can tick/untick them yourself any time.'
  );
}

// ------------------------------------------------------------
// Run this ONCE, after addDoneResultColumnsToAssignments, to copy
// any already-logged completions into the new columns.
// ------------------------------------------------------------
function backfillDoneFromCompletionLog() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var asg = ss.getSheetByName(ASSIGNMENTS_SHEET);
  var asgData = asg.getDataRange().getValues();
  var headers = asgData[0];
  var log = sheetToObjects(ss.getSheetByName(LOG_SHEET));
  var updated = 0;

  log.forEach(function (entry) {
    if (entry['Done'] !== true) return;
    var doneCol = headers.indexOf(entry['Kid'] + ' Done');
    var resultCol = headers.indexOf(entry['Kid'] + ' Result');
    if (doneCol === -1) return;
    var ed = new Date(entry['Date']);
    ed.setHours(0, 0, 0, 0);
    for (var i = 1; i < asgData.length; i++) {
      var rd = new Date(asgData[i][0]);
      rd.setHours(0, 0, 0, 0);
      var rowKid = asgData[i][1];
      if (rd.getTime() === ed.getTime() && asgData[i][2] === entry['Exercise Name'] && (rowKid === entry['Kid'] || rowKid === 'Both')) {
        asg.getRange(i + 1, doneCol + 1).setValue(true);
        if (resultCol > -1) asg.getRange(i + 1, resultCol + 1).setValue(entry['Result Value'] || '');
        updated++;
        break;
      }
    }
  });

  SpreadsheetApp.getUi().alert('Backfill complete. Updated ' + updated + ' row(s).');
}

// ------------------------------------------------------------
// WEB APP ENDPOINTS — called by the touchscreen/phone app
// ------------------------------------------------------------
function doGet(e) {
  var action = e.parameter.action || 'getAssignments';
  if (action === 'getAssignments') return jsonResponse(getAssignments(e.parameter.date));
  if (action === 'getProgress') return jsonResponse(getProgress(e.parameter.kid, e.parameter.exercise));
  if (action === 'getLibrary') return jsonResponse(getLibrary());
  // v2 Training Hub (/training/ frontend)
  if (action === 'getPlayers') return jsonResponse(v2GetPlayers());
  if (action === 'getHub') return jsonResponse(v2GetHub(e.parameter.player, e.parameter.date));
  return jsonResponse({ error: 'unknown action' });
}

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  if (data.action === 'markComplete') {
    markComplete(data.date, data.kid, data.exercise, data.resultValue);
    return jsonResponse({ success: true });
  }
  if (data.action === 'toggleSet') return jsonResponse(v2ToggleSet(data));
  if (data.action === 'setResult') return jsonResponse(v2SetResult(data));
  if (data.action === 'setVisual') return jsonResponse(v2SetVisual(data));
  if (data.action === 'setFeedback') return jsonResponse(v2SetFeedback(data));
  return jsonResponse({ error: 'unknown action' });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheetToObjects(sheet) {
  var data = sheet.getDataRange().getValues();
  var headers = data.shift();
  return data
    .filter(function (row) { return row[0] !== ''; })
    .map(function (row) {
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    });
}

function getLibrary() {
  return sheetToObjects(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LIBRARY_SHEET));
}

function getAssignments(dateStr) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var assignments = sheetToObjects(ss.getSheetByName(ASSIGNMENTS_SHEET));
  var library = getLibrary();

  var libByName = {};
  library.forEach(function (l) { libByName[l['Exercise Name']] = l; });

  var targetDate = dateStr ? new Date(dateStr) : new Date();
  targetDate.setHours(0, 0, 0, 0);

  var todays = assignments.filter(function (a) {
    var d = new Date(a['Date']);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === targetDate.getTime();
  });

  // A "Both" row is a single assignment meant for the whole family workout —
  // expand it into one entry per kid. Each kid's Done/Result columns are
  // independent, so this doesn't check one off when the other completes it.
  var expanded = [];
  todays.forEach(function (a) {
    if (a['Kid'] === 'Both') {
      KIDS.forEach(function (k) { expanded.push(buildAssignmentEntry(a, k, libByName)); });
    } else {
      expanded.push(buildAssignmentEntry(a, a['Kid'], libByName));
    }
  });

  return expanded;
}

function buildAssignmentEntry(a, kid, libByName) {
  var lib = libByName[a['Exercise Name']] || {};
  return {
    date: a['Date'],
    kid: kid,
    exercise: a['Exercise Name'],
    sets: a['Sets'],
    reps: a['Reps'],
    youtubeLink: lib['YouTube Link'] || '',
    category: lib['Category'] || '',
    resultType: lib['Result Type'] || 'None',
    done: a[kid + ' Done'] === true,
    resultValue: a[kid + ' Result'] || null
  };
}

function markComplete(dateStr, kid, exercise, resultValue) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // The Daily Assignments row's own Done/Result columns are the live
  // completion state — visible and manually editable right in the sheet.
  var asg = ss.getSheetByName(ASSIGNMENTS_SHEET);
  var asgData = asg.getDataRange().getValues();
  var headers = asgData[0];
  var doneCol = headers.indexOf(kid + ' Done');
  var resultCol = headers.indexOf(kid + ' Result');
  var d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);

  for (var i = 1; i < asgData.length; i++) {
    var rd = new Date(asgData[i][0]);
    rd.setHours(0, 0, 0, 0);
    var rowKid = asgData[i][1];
    if (rd.getTime() === d.getTime() && asgData[i][2] === exercise && (rowKid === kid || rowKid === 'Both')) {
      if (doneCol > -1) asg.getRange(i + 1, doneCol + 1).setValue(true);
      if (resultCol > -1) asg.getRange(i + 1, resultCol + 1).setValue(resultValue || '');
      break;
    }
  }

  // Completion Log stays a timestamped history feed for progress charts.
  var log = ss.getSheetByName(LOG_SHEET);
  var logData = log.getDataRange().getValues();
  for (var j = 1; j < logData.length; j++) {
    var ld = new Date(logData[j][0]);
    ld.setHours(0, 0, 0, 0);
    if (ld.getTime() === d.getTime() && logData[j][1] === kid && logData[j][2] === exercise) {
      log.getRange(j + 1, 4).setValue(true);
      log.getRange(j + 1, 5).setValue(resultValue || '');
      log.getRange(j + 1, 6).setValue(new Date());
      return;
    }
  }
  log.appendRow([dateStr, kid, exercise, true, resultValue || '', new Date()]);
}

function getProgress(kid, exercise) {
  var log = sheetToObjects(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET));
  return log
    .filter(function (l) { return l['Kid'] === kid && l['Exercise Name'] === exercise && l['Done'] === true; })
    .map(function (l) { return { date: l['Date'], value: l['Result Value'] }; })
    .sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
}


// ============================================================
// V2 — TRAINING HUB (frontend lives in /training/)
// ============================================================
// Three tracks a day (Morning / After School / Night). Each track is a
// standing menu of Must-dos plus "pick any" Options from the Activity
// Library. Every checked set earns points, which feed a weekly fuse
// (resets Monday) and a long-term Big prize. Kept alongside v1 above so
// the original app keeps working until the switch-over.
//
// Tabs (created by setupV2, safe to re-run — never clears data):
//   Players          — who can use the hub, which tracks, bomb/thermometer
//   Activity Library — every drill: category, tracks, sets, points, video
//   Track Plan       — what shows on each player's tracks (an Activity ID,
//                      or "Category: X" to list a whole category as options)
//   Set Log          — one row per checked set (the app writes here)
//   Prizes           — weekly + big prize names and point targets
// ============================================================

var V2_PLAYERS = 'Players';
var V2_LIB = 'Activity Library';
var V2_PLAN = 'Track Plan';
var V2_LOG = 'Set Log';
var V2_PRIZES = 'Prizes';
var V2_TRACKS = ['Morning', 'After School', 'Night'];

var V2_HEADERS = {
  'Players': ['Player', 'Tracks', 'Visual', 'Theme', 'Active'],
  'Activity Library': ['ID', 'Name', 'Category', 'Tracks', 'Sets', 'Per Set', 'Set Labels', 'Points Per Set',
                       'Video', 'Cue', 'Result', 'Result Of', 'Source', 'Active'],
  'Track Plan': ['Player', 'Track', 'Activity', 'Type', 'Order', 'Active'],
  'Set Log': ['Key', 'Date', 'Player', 'Track', 'Activity ID', 'Set', 'Points', 'Result', 'Done', 'Updated At'],
  'Prizes': ['Player', 'Type', 'Prize', 'Target Points', 'Start Date', 'Note']
};

// [ID, Name, Category, Tracks, Sets, Per Set, Set Labels (| separated), Points/Set, Video, Cue, Result, Result Of, Source]
var V2_SEED_LIBRARY = [
  // Garage / no hoop (morning 6:30 routine)
  ['G1', 'Ball raises (slow, to set point)', 'Garage / No Hoop', 'Morning', 2, '5 slow reps', '', 1, 'https://youtu.be/0mdidcb1GxU', 'Ball starts on your shooting side. Pause, then lower.', '', '', 'Dunn (garage version)'],
  ['G2', '1-2-Thru rehearsal (no release)', 'Garage / No Hoop', 'Morning', 2, '5 slow reps', '', 1, 'https://youtu.be/0t2i7OYeWKc', 'Move through the shot, stop before letting go, reset.', '', '', 'Dunn (garage version)'],
  ['G3', 'One-hand path (freeze before release)', 'Garage / No Hoop', 'Morning', 1, '6 reps', '', 1, 'https://youtu.be/_9xbKNbJ4ag', 'Shooting hand controls the ball. Freeze before release.', '', '', 'Dunn (garage version)'],
  ['G4', 'Guide-hand slide (no release)', 'Garage / No Hoop', 'Morning', 1, '6 reps', '', 1, 'https://youtu.be/o1gQlfPGFWE', 'Guide hand balances, then slides away. It never pushes.', '', '', 'Dunn (garage version)'],
  ['G5', 'Movement into set', 'Garage / No Hoop', 'Morning', 2, '3 reps', 'Stationary start ×3|Small step-in ×3', 1, '', 'Self-toss or ball at hip, rise to a balanced set, pause. No jump.', '', '', 'Love (garage version)'],
  ['G6', 'Finish freeze', 'Garage / No Hoop', 'Morning', 1, '3 slow reps', '', 1, '', 'Hold a relaxed finish 2 seconds, finger toward the target.', '', '', 'Garage routine'],
  ['G7', 'Reset + name one cue', 'Mindset', 'Morning', 1, '3 breaths + 1 cue', '', 1, '', 'Say one cue to remember next time.', '', '', 'Garage routine'],
  // Mike Dunn — Ground Up
  ['D1', 'Ball Raises', 'Dunn Shooting', 'Night', 5, '10 reps', '1–10|11–20|21–30|31–40|41–50', 1, 'https://youtu.be/0mdidcb1GxU', 'Find your comfortable "1" position. Ball moves first.', '', '', 'Mike Dunn · Ground Up'],
  ['D2', '1-2-Thru', 'Dunn Shooting', 'Night', 5, '20 reps', '1–20|21–40|41–60|61–80|81–100', 1, 'https://youtu.be/0t2i7OYeWKc', 'Choppy is OK. Smooth it out: "just pass it to the basket."', '', '', 'Mike Dunn · Ground Up'],
  ['D3', 'Shoot the Line', 'Dunn Shooting', 'Night', 5, '5 reps', '1–5|6–10|11–15|16–20|21–25', 1, 'https://youtu.be/YGyu7HBtk3s', 'Ball first, legs second.', '', '', 'Mike Dunn · Ground Up'],
  ['D4', 'Shoot to Yourself', 'Dunn Shooting', 'Night', 5, '10 reps', '1–10|11–20|21–30|31–40|41–50', 1, '', 'Straight up, catch it straight down, no bounce. Outside or under a high ceiling only.', '', '', 'Mike Dunn · Ground Up'],
  ['D5', 'Backboard Shots – Flat Side', 'Dunn Shooting', 'After School', 5, '10 reps', '', 1, 'https://youtu.be/bPZNr7iItnE', '', '', '', 'Mike Dunn · Ground Up'],
  ['D6', 'Backboard Shots – Skinny Side', 'Dunn Shooting', 'After School', 3, '10 reps', '', 1, 'https://youtu.be/U-I576autFs', '', '', '', 'Mike Dunn · Ground Up'],
  ['D7', 'Wide Stance Shots (5–10 ft)', 'Dunn Shooting', 'After School', 5, '10 makes', 'Baseline R|Wing R|Center|Wing L|Baseline L', 1, 'https://youtu.be/QHhBWyY-TDg', 'The ball never stops from start to finish.', '', '', 'Mike Dunn · Ground Up'],
  ['D8', 'Roll Ups (5–10 ft)', 'Dunn Shooting', 'After School', 5, '10 makes', 'Baseline R|Wing R|Center|Wing L|Baseline L', 1, 'https://youtu.be/-c7kfpIkccg', 'Smooth from start to finish.', '', '', 'Mike Dunn · Ground Up'],
  ['D9', 'One Hand Pullbacks (10 ft)', 'Dunn Shooting', 'After School', 5, '5 makes', 'Baseline R|Wing R|Center|Wing L|Baseline L', 1, 'https://youtu.be/_9xbKNbJ4ag', 'One hand isolates the shooting hand.', '', '', 'Mike Dunn · Ground Up'],
  ['D10', 'One Hand Pullbacks with Hop', 'Dunn Shooting', 'After School', 5, '5 makes', '', 1, 'https://youtu.be/k0U5zyFUHh4', 'Too hard? Hop with two hands, then shoot one-handed.', '', '', 'Mike Dunn · Ground Up'],
  ['D11', 'Form Shooting with Guide Hand Slides', 'Dunn Shooting', 'After School', 5, '10 makes', '', 1, 'https://youtu.be/o1gQlfPGFWE', 'The guide hand only balances the ball.', '', '', 'Mike Dunn · Ground Up'],
  ['D12', 'One Position Hops (forward / back)', 'Dunn Shooting', 'After School', 5, '5 makes', 'Baseline R|Wing R|Center|Wing L|Baseline L', 1, 'https://youtu.be/YsOXL_hDHYY', '', '', '', 'Mike Dunn · Ground Up'],
  ['D13', 'Momentum Shots', 'Dunn Shooting', 'After School', 5, '10 makes', 'Baseline R|Wing R|Center|Wing L|Baseline L', 1, 'https://youtu.be/5qBwsCVxtBE', 'Release the ball on the way up.', '', '', 'Mike Dunn · Ground Up'],
  ['D14', 'Hand Prep Drill', 'Dunn Shooting', 'After School', 2, '25 makes (5 spots)', 'Right-hand pickup|Left-hand pickup', 2, 'https://youtu.be/QmohmURpaGo', 'Hands ready before the feet land.', '', '', 'Mike Dunn · Ground Up'],
  ['D15', 'Watch: Pass It to the Basket', 'Film & Study', 'After School,Night', 1, '1 video', '', 2, 'https://youtu.be/j6q-hDPr5VU', '', '', '', 'Mike Dunn · Ground Up'],
  // Dave Love
  ['L1', 'Float-up warm-up', 'Love Shooting', 'After School', 3, '10 makes', 'Right block|Middle|Left block', 1, '', '"Let the ball float up into the shelf." Wrist relaxed at the start.', '', '', 'Dave Love'],
  ['L2', 'Isolation drill (one hand)', 'Love Shooting', 'After School', 4, '8 shots', 'Shots 1–8|9–16|17–24|25–32', 1, '', 'Hold at the set point 3 sec, guide hand off. One-hand from 11–15 ft, new spot every shot. "Point your index finger at the back of the rim."', '', '', 'Dave Love'],
  ['L3', 'ABC shots', 'Love Shooting', 'After School', 3, '10 shots', 'ABC 1–10|11–20|21–30', 1, '', 'Triple threat → float up to the set point → release with your finger at the rim.', '', '', 'Dave Love'],
  ['L4', 'Land and freeze', 'Love Shooting', 'After School', 3, '10 shots', 'Right wing|Straight on|Left wing', 1, '', 'From 15 ft. Toes to the rim, land on both feet, freeze 2 sec.', '', '', 'Dave Love'],
  ['L5', 'Target shooting (front of rim)', 'Love Shooting', 'After School', 4, '10 shots', 'Left wing|Left elbow|Right elbow|Right wing', 1, '', 'Swish it just over the front of the rim.', '', '', 'Dave Love'],
  ['L6', 'Hop and stick', 'Love Shooting', 'After School', 6, '5 shots', 'Spot 1 hop L|Spot 1 hop R|Spot 2 hop L|Spot 2 hop R|Spot 3 hop L|Spot 3 hop R', 1, '', 'Hop sideways, stay balanced when you land.', '', '', 'Dave Love'],
  ['L7', 'Free-throw test (20)', 'Tests', 'After School', 4, '5 free throws', 'FTs 1–5|6–10|11–15|16–20', 1, '', 'Normal routine. Enter your makes.', 'Makes', 20, 'Dave Love'],
  ['L8', 'Spot test: 3 spots × 20 (15 ft)', 'Tests', 'After School', 3, '20 shots', 'Right wing|Straight on|Left wing', 1, '', 'Enter total makes out of 60.', 'Makes', 60, 'Shot Lab standard'],
  ['L9', 'Film your shot (front + side)', 'Film & Study', 'After School', 2, '3–5 shots', 'Front view|Side view', 2, '', 'Phone at chest height, whole body + rim in the frame.', '', '', 'Dave Love'],
  ['L10', 'Watch a Total Shooter Transformation lesson', 'Film & Study', 'After School,Night', 1, '1 lesson', '', 3, 'https://www.coachdavelove.com/product/tst', '', '', '', 'Dave Love'],
  // Dribbling
  ['B1', 'Stationary pound dribbles', 'Dribbling', 'After School,Night', 4, '30 sec', 'Right hand|Left hand|Right low|Left low', 1, '', 'Eyes up. Pound it hard.', '', '', 'Hoegh basics'],
  ['B2', 'Crossover series', 'Dribbling', 'After School,Night', 3, '30 sec', 'In front|Between legs|Behind back', 1, '', 'Low and quick.', '', '', 'Hoegh basics'],
  ['B3', 'Two-ball dribbling', 'Dribbling', 'After School,Night', 3, '30 sec', 'Together|Alternating|High-low', 1, '', 'Weak hand matches strong hand.', '', '', 'Hoegh basics'],
  ['B4', 'Figure 8s and wraps', 'Dribbling', 'After School,Night', 2, '30 sec', '', 1, '', '', '', '', 'Hoegh basics'],
  ['B5', 'Ball-handling reel drill', 'Dribbling', 'After School,Night', 3, '30 sec', '', 1, 'https://www.instagram.com/reel/DeQM9GKBCUg/', 'Watch the reel, then copy the drill.', '', '', 'Ball handling sheet'],
  // Lifting (bodyweight, age-appropriate)
  ['S1', 'Push-ups', 'Lifting', 'Morning,After School,Night', 3, '10 reps', '', 1, '', 'Straight line from head to heels.', '', '', 'Hoegh basics'],
  ['S2', 'Bodyweight squats', 'Lifting', 'Morning,After School,Night', 3, '12 reps', '', 1, '', 'Chest up, knees over toes.', '', '', 'Hoegh basics'],
  ['S3', 'Split squats', 'Lifting', 'Morning,After School,Night', 2, '8 each leg', 'Right leg|Left leg', 1, '', 'Slow down, drive up.', '', '', 'Hoegh basics'],
  ['S4', 'Plank', 'Lifting', 'Morning,After School,Night', 3, '30 sec', '', 1, '', 'Squeeze your glutes and breathe.', '', '', 'Hoegh basics'],
  ['S5', 'Glute bridges', 'Lifting', 'Morning,After School,Night', 3, '12 reps', '', 1, '', 'Squeeze at the top.', '', '', 'Hoegh basics'],
  ['S6', 'Calf raises', 'Lifting', 'Morning,After School,Night', 2, '20 reps', '', 1, '', 'All the way up, slow down.', '', '', 'Hoegh basics'],
  // Explosive / agility
  ['E1', 'Broad jumps', 'Explosive', 'After School', 3, '3 jumps', '', 1, '', 'Swing your arms, stick the landing.', 'Distance', '', 'Hoegh basics'],
  ['E2', 'Pogo hops', 'Explosive', 'After School,Night', 3, '20 hops', '', 1, '', 'Quick ankles, tall body.', '', '', 'Hoegh basics'],
  ['A1', 'Line hops (fast feet)', 'Agility & Quickness', 'After School,Night', 3, '20 sec', 'Side to side|Front to back|Single leg', 1, '', 'Stay on the balls of your feet.', '', '', 'Hoegh basics']
];

// Player, Track, Activity (ID or "Category: X"), Type, Order
var V2_SEED_PLAN = [
  ['All', 'Morning', 'G1', 'Must-do', 1], ['All', 'Morning', 'G2', 'Must-do', 2], ['All', 'Morning', 'G3', 'Must-do', 3],
  ['All', 'Morning', 'G4', 'Must-do', 4], ['All', 'Morning', 'G5', 'Must-do', 5], ['All', 'Morning', 'G6', 'Must-do', 6],
  ['All', 'Morning', 'G7', 'Must-do', 7], ['All', 'Morning', 'Category: Lifting', 'Option', 20],
  ['All', 'After School', 'L1', 'Must-do', 1], ['All', 'After School', 'L2', 'Must-do', 2],
  ['All', 'After School', 'L3', 'Must-do', 3], ['All', 'After School', 'L4', 'Must-do', 4],
  ['All', 'After School', 'Category: Love Shooting', 'Option', 10], ['All', 'After School', 'Category: Tests', 'Option', 11],
  ['All', 'After School', 'Category: Dunn Shooting', 'Option', 12], ['All', 'After School', 'Category: Film & Study', 'Option', 13],
  ['All', 'After School', 'Category: Dribbling', 'Option', 14], ['All', 'After School', 'Category: Lifting', 'Option', 15],
  ['All', 'After School', 'Category: Explosive', 'Option', 16], ['All', 'After School', 'Category: Agility & Quickness', 'Option', 17],
  ['All', 'After School', 'Category: Defense', 'Option', 18], ['All', 'After School', 'Category: Rebounding', 'Option', 19],
  ['All', 'After School', 'Category: Shooting Feel', 'Option', 20], ['All', 'After School', 'Category: Team & Trainer', 'Option', 21],
  ['All', 'After School', 'Category: Basketball Skills', 'Option', 22],
  ['All', 'Night', 'D1', 'Must-do', 1], ['All', 'Night', 'D2', 'Must-do', 2], ['All', 'Night', 'D3', 'Must-do', 3],
  ['All', 'Night', 'D4', 'Must-do', 4],
  ['All', 'Night', 'Category: Dribbling', 'Option', 10], ['All', 'Night', 'Category: Lifting', 'Option', 11],
  ['All', 'Night', 'Category: Agility & Quickness', 'Option', 12], ['All', 'Night', 'Category: Explosive', 'Option', 13],
  ['All', 'Night', 'Category: Film & Study', 'Option', 14]
];

// ------------------------------------------------------------
// Run ONCE from the Apps Script editor (select "setupV2", click Run).
// Creates only the v2 tabs that don't exist yet, so it's safe to re-run;
// existing v1 tabs and data are never touched.
// ------------------------------------------------------------
function setupV2() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var created = [];
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  function ensure(name, seedRows) {
    if (ss.getSheetByName(name)) return null;
    var sh = ss.insertSheet(name);
    var h = V2_HEADERS[name];
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (seedRows && seedRows.length) sh.getRange(2, 1, seedRows.length, h.length).setValues(seedRows);
    created.push(name);
    return sh;
  }

  ensure(V2_PLAYERS, [
    ['Nellie', 'Morning,After School,Night', 'Bomb', 'nellie', true],
    ['Nash', 'Morning,After School,Night', 'Bomb', 'nash', true],
    ['Titus', 'Night', 'Bomb', 'titus', false],
    ['Tatum', 'Night', 'Bomb', 'tatum', false]
  ]);

  var libRows = V2_SEED_LIBRARY.map(function (r) { return r.concat([true]); });
  libRows = libRows.concat(v2MigrateExerciseLibrary(ss));
  var lib = ensure(V2_LIB, libRows);
  if (lib) lib.setColumnWidth(2, 260);

  var plan = ensure(V2_PLAN, V2_SEED_PLAN.map(function (r) { return r.concat([true]); }));
  if (plan) plan.getRange(2, 4, 500, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Must-do', 'Option'], true).build());

  var log = ensure(V2_LOG, []);
  if (log) log.getRange('A:B').setNumberFormat('@'); // keep keys and dates as plain text

  var prizes = ensure(V2_PRIZES, [
    ['All', 'Weekly', 'Weekly prize — you pick it!', 150, today, 'Resets every Monday. Type the prize name here once they choose.'],
    ['All', 'Big', 'Big prize — you pick it!', 1000, today, 'Counts every point since the start date. Type the prize name here once they choose.']
  ]);
  if (prizes) prizes.getRange('E:E').setNumberFormat('@');

  var msg = created.length ? 'Created: ' + created.join(', ') : 'All v2 tabs already exist — nothing changed.';
  v2BumpCache();
  try { SpreadsheetApp.getUi().alert(msg); } catch (err) { Logger.log(msg); }
}

// Copies the v1 Exercise Library into v2 rows with best-guess categories.
function v2MigrateExerciseLibrary(ss) {
  var sh = ss.getSheetByName(LIBRARY_SHEET);
  if (!sh) return [];
  var rows = sheetToObjects(sh);
  return rows.map(function (r, i) {
    var name = String(r['Exercise Name']).trim();
    var n = name.toLowerCase();
    var cat = { 'Explosiveness': 'Explosive', 'Quickness': 'Agility & Quickness', 'Strength': 'Lifting',
                'Foundational': 'Agility & Quickness' }[r['Category']] || 'Basketball Skills';
    if (/dribbl|pound/.test(n)) cat = 'Dribbling';
    else if (/rebound|tap drill/.test(n)) cat = 'Rebounding';
    else if (/close out/.test(n)) cat = 'Defense';
    else if (/session|personal training/.test(n)) cat = 'Team & Trainer';
    else if (/spin|catch - load/.test(n)) cat = 'Shooting Feel';
    var tracks = /jump rope/.test(n) ? 'After School,Night' : 'After School';
    var result = { 'Weight': 'Weight', 'Distance': 'Distance', 'Time': 'Time' }[r['Result Type']] || '';
    var isSession = cat === 'Team & Trainer';
    return ['X' + (i + 1), name, cat, tracks, isSession ? 1 : 2, isSession ? '1 session' : 'reps', '',
            isSession ? 5 : 1, r['YouTube Link'] || '', '', result, '', 'Home Hub library', true];
  });
}

// ---------- helpers ----------

function v2Ymd(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v || '').slice(0, 10);
}

function v2AddDays(ymd, n) {
  var p = ymd.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function v2WeekStart(ymd) { // Monday
  var p = ymd.split('-');
  var dow = (new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay() + 6) % 7;
  return v2AddDays(ymd, -dow);
}

function v2Rows(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) return null;
  return sheetToObjects(sh);
}

// ---- Sheet cache (2026-10-14) ----
// Every Apps Script call already costs ~2 s of Google overhead, and getHub used to read
// six tabs on top of that. The four tabs that rarely change (Players, Activity Library,
// Track Plan, Prizes) are now cached for up to 10 minutes and dropped the moment the
// Sheet is edited by hand (onEdit below) or a setup function / setVisual changes them.
// The Set Log is still read fresh on every call, so check-offs are never stale.
function v2CacheGen() {
  var c = CacheService.getScriptCache(), g = c.get('v2gen');
  if (!g) { g = String(Date.now()); c.put('v2gen', g, 21600); }
  return g;
}
function v2BumpCache() {
  try {
    var c = CacheService.getScriptCache();
    c.put('v2gen', String(Date.now()) + '-' + Math.floor(Math.random() * 1e6), 21600);
    c.remove('v2fb');
  } catch (e) {}
}
// Simple trigger: runs on any manual edit to the Sheet (not on the app's own writes).
function onEdit(e) { v2BumpCache(); }

function v2Data() {
  var c = CacheService.getScriptCache(), key = 'v2data|' + v2CacheGen();
  try { var hit = c.get(key); if (hit) return JSON.parse(hit); } catch (e) {}
  // Dates become plain YYYY-MM-DD text so the cached copy reads exactly like the sheet.
  var clean = function (rows) {
    return rows && rows.map(function (r) {
      var o = {};
      Object.keys(r).forEach(function (k) { o[k] = r[k] instanceof Date ? v2Ymd(r[k]) : r[k]; });
      return o;
    });
  };
  var d = { players: clean(v2Rows(V2_PLAYERS)), lib: clean(v2Rows(V2_LIB)), plan: clean(v2Rows(V2_PLAN)), prizes: clean(v2Rows(V2_PRIZES)) };
  if (d.players && d.lib && d.plan && d.prizes) { try { c.put(key, JSON.stringify(d), 600); } catch (e) {} }
  return d;
}

function v2ActivePlayers(rows) {
  return (rows || []).filter(function (p) { return v2Truthy(p['Active']); }).map(function (p) {
    return { name: p['Player'], tracks: v2List(p['Tracks']), visual: p['Visual'] || 'Bomb', theme: p['Theme'] || '' };
  });
}

function v2List(s) {
  return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(String);
}

function v2Truthy(v) { return !(v === false || String(v).toUpperCase() === 'FALSE'); }

function v2Item(a) {
  var sets = Math.max(1, parseInt(a['Sets'], 10) || 1);
  var labels = String(a['Set Labels'] || '').split('|').map(function (x) { return x.trim(); }).filter(String);
  return {
    id: String(a['ID']), name: a['Name'], category: a['Category'], source: a['Source'] || '',
    sets: sets, perSet: a['Per Set'] || '', labels: labels,
    pts: Number(a['Points Per Set']) || 1, video: a['Video'] || '', cue: a['Cue'] || '',
    result: a['Result'] || '', resultOf: Number(a['Result Of']) || null
  };
}

// ---------- GET ----------

function v2GetPlayers() {
  var rows = v2Data().players;
  if (!rows) return { error: 'v2 not set up' };
  return v2ActivePlayers(rows);
}

// One player's tracks (must-dos + option groups), built from the cached Sheet tabs.
// Used by getHub and by v3Publish (which copies it into the fast database).
function v2PlanFor(data, player) {
  var players = data.players, libRows = data.lib, plan = data.plan;
  var p = players.filter(function (x) { return x['Player'] === player && v2Truthy(x['Active']); })[0];
  if (!p) return null;
  var tracks = v2List(p['Tracks']).filter(function (t) { return V2_TRACKS.indexOf(t) > -1; });

  var lib = libRows.filter(function (a) { return a['ID'] !== '' && v2Truthy(a['Active']); });
  var byId = {};
  lib.forEach(function (a) { byId[String(a['ID'])] = a; });

  var out = {};
  tracks.forEach(function (t) {
    var rows = plan.filter(function (r) {
      var who = v2List(r['Player']);
      return r['Track'] === t && v2Truthy(r['Active']) && (who.indexOf('All') > -1 || who.indexOf(player) > -1);
    }).sort(function (a, b) { return (Number(a['Order']) || 0) - (Number(b['Order']) || 0); });
    var listed = {}, must = [], groups = [];
    rows.forEach(function (r) {
      var act = String(r['Activity']).trim();
      if (act.indexOf('Category:') !== 0 && byId[act]) listed[act] = true;
    });
    rows.forEach(function (r) {
      var act = String(r['Activity']).trim(), type = r['Type'] === 'Must-do' ? 'must' : 'option';
      var items;
      if (act.indexOf('Category:') === 0) {
        var cat = act.slice(9).trim();
        items = lib.filter(function (a) {
          return a['Category'] === cat && v2List(a['Tracks']).indexOf(t) > -1 && !listed[String(a['ID'])];
        });
      } else {
        items = byId[act] ? [byId[act]] : [];
      }
      items = items.map(v2Item);
      var setsOverride = parseInt(r['Sets'], 10);
      if (act.indexOf('Category:') !== 0 && setsOverride > 0) {
        items.forEach(function (it) { it.sets = setsOverride; it.labels = it.labels.slice(0, setsOverride); });
      }
      if (!items.length) return;
      if (type === 'must') must = must.concat(items);
      else {
        items.forEach(function (it) {
          var g = groups.filter(function (x) { return x.category === it.category; })[0];
          if (!g) { g = { category: it.category, items: [] }; groups.push(g); }
          if (!g.items.some(function (x) { return x.id === it.id; })) g.items.push(it);
        });
      }
    });
    out[t] = { must: must, options: groups };
  });
  return { p: p, trackNames: tracks, tracks: out };
}

function v2GetHub(player, date) {
  var data = v2Data();
  var players = data.players, prizes = data.prizes, log = v2Rows(V2_LOG);
  if (!players || !data.lib || !data.plan || !log || !prizes) return { error: 'v2 not set up' };
  date = date || v2Ymd(new Date());
  var built = v2PlanFor(data, player);
  if (!built) return { error: 'unknown player' };
  var p = built.p, tracks = built.trackNames, out = built.tracks;

  // Prizes: a player-specific row wins over an "All" row; latest start date that has begun.
  function prizeFor(type) {
    var rows = prizes.filter(function (r) {
      return r['Type'] === type && (r['Player'] === player || r['Player'] === 'All') && v2Ymd(r['Start Date']) <= date;
    }).sort(function (a, b) {
      var sa = v2Ymd(a['Start Date']), sb = v2Ymd(b['Start Date']);
      if (sa !== sb) return sa < sb ? 1 : -1;
      return (a['Player'] === player ? -1 : 1);
    });
    var r = rows[0];
    return r ? { prize: r['Prize'], target: Number(r['Target Points']) || 100, start: v2Ymd(r['Start Date']) } : null;
  }
  var weekly = prizeFor('Weekly'), big = prizeFor('Big');
  var events = v2EventsFor(p, date);
  v2ApplyTodos(out, v2CalendarTodos(data, p, events));

  var ws = v2WeekStart(date), we = v2AddDays(ws, 6);
  var done = {}, results = {}, history = {};
  var pts = { today: 0, week: 0, big: 0, lifetime: 0, byDay: {} };
  log.forEach(function (r) {
    if (r['Player'] !== player) return;
    var d = v2Ymd(r['Date']), set = Number(r['Set']), isDone = r['Done'] === true || String(r['Done']).toUpperCase() === 'TRUE';
    var k = r['Track'] + '|' + r['Activity ID'];
    if (set === 0) {
      if (r['Result'] !== '' && r['Result'] != null) {
        (history[r['Activity ID']] = history[r['Activity ID']] || []).push({ date: d, value: Number(r['Result']) });
        if (d === date) results[k] = Number(r['Result']);
      }
      return;
    }
    if (!isDone) return;
    var pt = Number(r['Points']) || 0;
    if (d === date) done[k + '|' + set] = true;
    pts.lifetime += pt;
    pts.byDay[d] = (pts.byDay[d] || 0) + pt;
    if (d === date) pts.today += pt;
    if (d >= ws && d <= we) pts.week += pt;
    if (big && d >= big.start) pts.big += pt;
  });

  return {
    player: { name: p['Player'], tracks: tracks, visual: p['Visual'] || 'Bomb', theme: p['Theme'] || '' },
    date: date, weekStart: ws, tracks: out, done: done, results: results, history: history,
    points: pts, prizes: { weekly: weekly, big: big }, events: events,
    feedback: v2FeedbackFor(player),
    players: v2ActivePlayers(players)  // lets the app skip a separate getPlayers call
  };
}

// ---------- POST ----------

function v2Upsert(key, row) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(V2_LOG);
  var hit = sh.getRange('A:A').createTextFinder(key).matchEntireCell(true).findNext();
  if (hit) sh.getRange(hit.getRow(), 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}

function v2ToggleSet(d) {
  if (!d.date || !d.player || !d.track || !d.activity || !(Number(d.set) > 0)) return { error: 'bad request' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var lib = v2Data().lib || [];
    var a = lib.filter(function (x) { return String(x['ID']) === String(d.activity); })[0];
    var pts = a ? (Number(a['Points Per Set']) || 1) : 1;
    var key = [d.date, d.player, d.track, d.activity, d.set].join('|');
    v2Upsert(key, [key, d.date, d.player, d.track, d.activity, Number(d.set), pts, '', d.done === true, new Date()]);
    v3Forward('set_log', { id: key, day: d.date, player: d.player, track: d.track, activity: String(d.activity), set_no: Number(d.set), points: pts, result: null, done: d.done === true });
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function v2SetResult(d) {
  if (!d.date || !d.player || !d.track || !d.activity) return { error: 'bad request' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var key = [d.date, d.player, d.track, d.activity, 0].join('|');
    var val = d.result === null || d.result === '' || d.result === undefined ? '' : Number(d.result);
    v2Upsert(key, [key, d.date, d.player, d.track, d.activity, 0, 0, val, val !== '', new Date()]);
    v3Forward('set_log', { id: key, day: d.date, player: d.player, track: d.track, activity: String(d.activity), set_no: 0, points: 0, result: val === '' ? null : val, done: val !== '' });
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function v2SetVisual(d) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(V2_PLAYERS);
  if (!sh || ['Bomb', 'Thermometer'].indexOf(d.visual) === -1) return { error: 'bad request' };
  var data = sh.getDataRange().getValues();
  var col = data[0].indexOf('Visual');
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === d.player) {
      sh.getRange(i + 1, col + 1).setValue(d.visual); v2BumpCache();
      v3Forward('player_settings', { player: d.player, visual: d.visual });
      return { ok: true };
    }
  }
  return { error: 'unknown player' };
}

// ------------------------------------------------------------
// Run ONCE after setupV2: carries the Oct 7 baseline tests over from the
// old claude.ai Shot Lab (results only — no points, so prizes start fresh).
// ------------------------------------------------------------
function v2ImportShotLabBaselines() {
  [['Nellie', 'L7', 12], ['Nellie', 'L8', 25], ['Nash', 'L7', 14], ['Nash', 'L8', 28]].forEach(function (r) {
    v2SetResult({ date: '2026-10-07', player: r[0], track: 'After School', activity: r[1], result: r[2] });
  });
  try { SpreadsheetApp.getUi().alert('Imported 4 baseline test results from Oct 7.'); } catch (e) {}
}

// ------------------------------------------------------------
// Run ONCE (2026-10-13): turns Morning into a garage dribbling track.
// Stationary / limited-movement drills, each with a verified video (mostly
// Jr. NBA and Atlanta Hawks). The old garage shooting rehearsal (G1–G7)
// stays available as Morning options. Safe to re-run.
// ------------------------------------------------------------
var V2_MORNING_DRIBBLE_LIB = [
  // Must-do circuit, easiest to hardest
  ['M1', 'Ball wraps (head, waist, legs)', 'Dribbling', 'Morning,After School,Night', 3, '10 each way', 'Head ×10 each way|Waist ×10 each way|Legs ×10 each way', 1, 'https://youtu.be/IC9WsV0vkTo', 'Fingertips, not palms. Speed up as it gets easy.', '', '', 'Jr. NBA'],
  ['M2', 'Pound dribbles', 'Dribbling', 'Morning,After School,Night', 4, '30 sec', 'Right hand|Left hand|Right hand low|Left hand low', 1, 'https://youtu.be/5NGuEN0OHys', 'Pound it hard, eyes up, ball no higher than your waist.', '', '', 'Jr. NBA'],
  ['M3', 'Pound-pound / cross-cross', 'Dribbling', 'Morning,After School,Night', 2, '30 sec', '', 1, 'https://youtu.be/_GL9QJmvTys', 'Two hard pounds, then two quick crossovers. Stay low.', '', '', 'Billy Clapper Basketball'],
  ['M4', 'In-and-out dribble', 'Dribbling', 'Morning,After School,Night', 2, '20 reps', 'Right hand ×20|Left hand ×20', 1, 'https://youtu.be/Fy3gNOuxHmw', 'Sell it with your shoulders. Keep the ball on your side.', '', '', 'Jr. NBA'],
  ['M5', 'Stationary crossover + between the legs', 'Dribbling', 'Morning,After School,Night', 3, '20 reps', 'Crossovers ×20|Between legs, right to left ×20|Between legs, left to right ×20', 1, 'https://youtu.be/h7s31K0kPh4', 'Low and tight. Switch your front foot for between the legs.', '', '', 'Atlanta Hawks'],
  ['M6', 'Behind-the-back wrap', 'Dribbling', 'Morning,After School,Night', 3, '10 reps', 'Right to left ×10|Left to right ×10|Back and forth ×10', 1, 'https://youtu.be/cGQ7dXW0jCA', 'Wrap the ball around your hip. Do not throw it.', '', '', 'Jr. NBA'],
  ['M7', 'Figure 8 dribble', 'Dribbling', 'Morning,After School,Night', 2, '30 sec', 'Forward 30 sec|Backward 30 sec', 1, 'https://youtu.be/-vafClV92A4', 'Wide stance, low dribbles through and around your legs.', '', '', 'Atlanta Hawks'],
  ['M8', '100 Dribble Drill (finisher)', 'Dribbling', 'Morning,After School,Night', 1, '100 dribbles, no mistakes', '100 in a row', 2, 'https://youtu.be/v_jqSQswdbU', 'Lose it? Start that move over.', '', '', 'Jr. NBA'],
  // Extra options
  ['M9', 'Spider dribble', 'Dribbling', 'Morning,After School,Night', 3, '20 sec', '', 1, 'https://youtu.be/QWmmIuBgdEI', 'Ball stays between your feet: right, left, behind right, behind left.', '', '', 'Jr. NBA'],
  ['M10', 'V-dribble challenge', 'Dribbling', 'Morning,After School,Night', 3, '10 reps', 'V cross ×10|V between ×10|V behind ×10', 1, 'https://youtu.be/rRw3YNz7UkU', 'Push the ball side to side in a V. Time yourself for all 30.', 'Time', '', 'Make Yourself'],
  ['M11', 'Two-ball dribble (same time)', 'Dribbling', 'Morning,After School,Night', 3, '30 sec', 'Low|Middle|High', 1, 'https://youtu.be/6nfnBHvDkRk', 'Both balls hit the floor together. Weak hand keeps up.', '', '', 'Jr. NBA'],
  ['M12', 'Two-ball series', 'Dribbling', 'Morning,After School,Night', 4, '30 sec', 'Pound together|Alternate|Side to side|Front to back', 1, 'https://youtu.be/EWmvLvlxtJ4', 'Eyes up the whole time.', '', '', 'Premier Hoops'],
  ['M13', 'Tennis ball dribble', 'Dribbling', 'Morning,After School,Night', 2, '30 sec', 'Right hand|Left hand', 1, 'https://youtu.be/wkusPZJKkis', 'Soft fingertips. Small ball means big control.', '', '', 'Teach Hoops'],
  ['M14', 'Single-leg wraps', 'Dribbling', 'Morning,After School,Night', 2, '10 each way', 'Right leg|Left leg', 1, 'https://youtu.be/Jy1dH97NW9A', 'Quick hands around one leg, then switch.', '', '', 'Jr. NBA'],
  ['M15', 'Under-the-leg dribble', 'Dribbling', 'Morning,After School,Night', 2, '10 reps', 'Right to left ×10|Left to right ×10', 1, 'https://youtu.be/KIBJzEn_QG8', 'Step through and switch hands under your leg.', '', '', 'Jr. NBA']
];
var V2_MORNING_MUSTS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'];

function v2MorningDribbling() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lib = ss.getSheetByName(V2_LIB), plan = ss.getSheetByName(V2_PLAN);
  if (!lib || !plan) throw new Error('Run setupV2 first.');

  // Library: add the new drills; retire the old video-less B1–B4 basics they replace.
  var libData = lib.getDataRange().getValues(), lh = libData[0];
  var idCol = lh.indexOf('ID'), activeCol = lh.indexOf('Active');
  var have = {};
  for (var i = 1; i < libData.length; i++) {
    have[String(libData[i][idCol])] = true;
    if (['B1', 'B2', 'B3', 'B4'].indexOf(String(libData[i][idCol])) > -1) lib.getRange(i + 1, activeCol + 1).setValue(false);
  }
  var addLib = V2_MORNING_DRIBBLE_LIB.filter(function (r) { return !have[r[0]]; }).map(function (r) { return r.concat([true]); });
  if (addLib.length) lib.getRange(lib.getLastRow() + 1, 1, addLib.length, addLib[0].length).setValues(addLib);

  // Plan: garage shooting becomes optional; the dribbling circuit becomes the Morning must-dos.
  var pData = plan.getDataRange().getValues(), ph = pData[0];
  var pc = { track: ph.indexOf('Track'), act: ph.indexOf('Activity'), type: ph.indexOf('Type') };
  var planned = {};
  for (var j = 1; j < pData.length; j++) {
    if (pData[j][pc.track] !== 'Morning') continue;
    var a = String(pData[j][pc.act]).trim();
    planned[a] = true;
    if (/^G\d$/.test(a) && pData[j][pc.type] === 'Must-do') plan.getRange(j + 1, pc.type + 1).setValue('Option');
  }
  var addPlan = [];
  V2_MORNING_MUSTS.forEach(function (id, k) { if (!planned[id]) addPlan.push(['All', 'Morning', id, 'Must-do', k + 1, true]); });
  [['Category: Dribbling', 20], ['Category: Garage / No Hoop', 21], ['Category: Mindset', 22]].forEach(function (c) {
    if (!planned[c[0]]) addPlan.push(['All', 'Morning', c[0], 'Option', c[1], true]);
  });
  if (addPlan.length) plan.getRange(plan.getLastRow() + 1, 1, addPlan.length, addPlan[0].length).setValues(addPlan);

  var msg = 'Morning is now a dribbling track: added ' + addLib.length + ' drills and ' + addPlan.length + ' plan rows.';
  v2BumpCache();
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

// ------------------------------------------------------------
// Run ONCE (2026-10-13): rebuilds Morning around Billy Clapper's higher-
// intensity ball handling ("Ball Handling At Its Best"). Jr. NBA videos are
// retired where Billy covers the same thing, and kept only as options where
// he has no equivalent. Safe to re-run.
// ------------------------------------------------------------
var V2_BILLY_LIB = [
  // Morning must-do circuit (M3 Pound-Pound/Cross-Cross, also Billy, stays in at #3)
  ['BC1', 'The Wrap Series', 'Dribbling', 'Morning,After School,Night', 3, '30 sec', '', 1, 'https://youtu.be/HXbfrR1FLLM', 'Fast hands. Match Billy’s speed.', '', '', 'Billy Clapper'],
  ['BC2', 'Stationary ball handling fundamentals', 'Dribbling', 'Morning,After School,Night', 4, '30 sec', '', 1, 'https://youtu.be/HY_w2gtm6F4', 'Hard and low, eyes up. Follow the video.', '', '', 'Billy Clapper'],
  ['BC4', 'Chop between the legs', 'Dribbling', 'Morning,After School,Night', 2, '30 sec', 'Right foot forward|Left foot forward', 1, 'https://youtu.be/FvL2tqNrQ7Q', 'Chop it hard and low.', '', '', 'Billy Clapper'],
  ['BC5', 'Small area ball handling', 'Dribbling', 'Morning,After School,Night', 3, '30 sec', '', 1, 'https://youtu.be/wi1zHlAn8z4', 'Tight space, quick feet, ball stays alive.', '', '', 'Billy Clapper'],
  ['BC6', 'Pull back dribble', 'Dribbling', 'Morning,After School,Night', 2, '10 reps', 'Right hand ×10|Left hand ×10', 1, 'https://youtu.be/5wkcgMnfycE', 'Attack, then pull back with the ball protected.', '', '', 'Billy Clapper'],
  ['BC7', 'Stationary two ball', 'Two Ball', 'Morning,After School,Night', 3, '30 sec', '', 1, 'https://youtu.be/0_sfQ5WBldA', 'Both hands work just as hard. Eyes up.', '', '', 'Billy Clapper'],
  ['BC8', 'Stationary one ball: full follow-along', 'Dribbling', 'Morning,After School,Night', 1, 'whole video', 'Did the whole video', 3, 'https://youtu.be/JWi7HBLm1Ys', 'Do the whole video with Billy. Restart a drill if you lose it.', '', '', 'Billy Clapper'],
  // Options: stationary or limited movement
  ['BC9', 'Two ball figure 8 series', 'Two Ball', 'Morning,After School,Night', 3, '30 sec', '', 1, 'https://youtu.be/EhO9ehSnDik', '', '', '', 'Billy Clapper'],
  ['BC10', 'Two ball triangle', 'Two Ball', 'Morning,After School,Night', 3, '30 sec', '', 1, 'https://youtu.be/fGGr9dR9hqI', '', '', '', 'Billy Clapper'],
  ['BC11', 'Two ball windmill alternate', 'Two Ball', 'Morning,After School,Night', 3, '30 sec', '', 1, 'https://youtu.be/rzu1cVbLO60', '', '', '', 'Billy Clapper'],
  ['BC12', 'Two ball front-to-back alternate', 'Two Ball', 'Morning,After School,Night', 3, '30 sec', '', 1, 'https://youtu.be/55ysHL39z-U', '', '', '', 'Billy Clapper'],
  ['BC13', 'Two balls in one hand', 'Two Ball', 'Morning,After School,Night', 2, '30 sec', 'Right hand|Left hand', 1, 'https://youtu.be/GmS7dqf96XQ', '', '', '', 'Billy Clapper'],
  ['BC14', 'Jab dribble attack move', 'Dribbling', 'Morning,After School,Night', 2, '10 reps', 'Going right ×10|Going left ×10', 1, 'https://youtu.be/cA3wJ_-Cues', 'Sell the jab, then go.', '', '', 'Billy Clapper'],
  ['BC15', 'Pro square ball handling', 'Dribbling', 'Morning,After School,Night', 3, '30 sec', '', 1, 'https://youtu.be/E_Ux900sh5E', '', '', '', 'Billy Clapper'],
  ['BC16', 'Tennis ball hand-eye drills', 'Dribbling', 'Morning,After School,Night', 3, '30 sec', '', 1, 'https://youtu.be/Nr-IVd-CuHU', 'Needs a tennis ball.', '', '', 'Billy Clapper'],
  ['BC17', 'Hand-eye coordination', 'Dribbling', 'Morning,After School,Night', 3, '30 sec', '', 1, 'https://youtu.be/WWGnRarOEw4', '', '', '', 'Billy Clapper'],
  // Options that need more room (after school only)
  ['BC18', 'Paint the circle: one ball and two ball', 'Dribbling', 'After School', 3, '1 lap', '', 1, 'https://youtu.be/M12myzgOXHc', 'Needs a circle on the court.', '', '', 'Billy Clapper'],
  ['BC19', 'Paint the circle: cover', 'Dribbling', 'After School', 3, '1 lap', '', 1, 'https://youtu.be/ImL0Wo1OIxo', 'Needs a circle on the court.', '', '', 'Billy Clapper'],
  ['BC20', 'Paint the circle: two ball cover', 'Two Ball', 'After School', 3, '1 lap', '', 1, 'https://youtu.be/tCfM5zVFI7M', 'Needs a circle on the court.', '', '', 'Billy Clapper'],
  ['BC21', 'Pro cone ballhandling', 'Dribbling', 'After School', 3, '1 round', '', 1, 'https://youtu.be/7j_3TNIbSiw', 'Needs cones.', '', '', 'Billy Clapper'],
  ['BC22', 'Pro cone ballhandling with crossovers', 'Dribbling', 'After School', 3, '1 round', '', 1, 'https://youtu.be/-HK--0Bmuro', 'Needs cones.', '', '', 'Billy Clapper']
];
var V2_BILLY_MUSTS = [['BC1', 1], ['BC2', 2], ['BC4', 4], ['BC5', 5], ['BC6', 6], ['BC7', 7], ['BC8', 8]];
// Jr. NBA / youth-level drills that Billy's videos replace.
var V2_RETIRE = ['M1', 'M2', 'M8', 'M11', 'M12', 'M13', 'M14'];

function v2MorningBillyClapper() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lib = ss.getSheetByName(V2_LIB), plan = ss.getSheetByName(V2_PLAN);
  if (!lib || !plan) throw new Error('Run setupV2 first.');

  var libData = lib.getDataRange().getValues(), lh = libData[0];
  var idCol = lh.indexOf('ID'), activeCol = lh.indexOf('Active');
  var have = {}, retired = 0;
  for (var i = 1; i < libData.length; i++) {
    var id = String(libData[i][idCol]);
    have[id] = true;
    if (V2_RETIRE.indexOf(id) > -1 && libData[i][activeCol] !== false) { lib.getRange(i + 1, activeCol + 1).setValue(false); retired++; }
  }
  var addLib = V2_BILLY_LIB.filter(function (r) { return !have[r[0]]; }).map(function (r) { return r.concat([true]); });
  if (addLib.length) lib.getRange(lib.getLastRow() + 1, 1, addLib.length, addLib[0].length).setValues(addLib);

  // Morning must-dos: drop the old Jr. NBA circuit rows (M3 stays), add Billy's.
  var pData = plan.getDataRange().getValues(), ph = pData[0];
  var pc = { track: ph.indexOf('Track'), act: ph.indexOf('Activity'), type: ph.indexOf('Type'), active: ph.indexOf('Active') };
  var planned = {};
  for (var j = 1; j < pData.length; j++) {
    if (pData[j][pc.track] !== 'Morning') continue;
    var a = String(pData[j][pc.act]).trim();
    planned[a] = true;
    if (/^M\d+$/.test(a) && a !== 'M3' && pData[j][pc.type] === 'Must-do') plan.getRange(j + 1, pc.active + 1).setValue(false);
  }
  var addPlan = [];
  V2_BILLY_MUSTS.forEach(function (m) { if (!planned[m[0]]) addPlan.push(['All', 'Morning', m[0], 'Must-do', m[1], true]); });
  ['Morning', 'After School', 'Night'].forEach(function (t) {
    var has = pData.some(function (r) { return r[pc.track] === t && String(r[pc.act]).trim() === 'Category: Two Ball'; });
    if (!has) addPlan.push(['All', t, 'Category: Two Ball', 'Option', 19, true]);
  });
  if (addPlan.length) plan.getRange(plan.getLastRow() + 1, 1, addPlan.length, addPlan[0].length).setValues(addPlan);

  var msg = 'Billy Clapper morning: added ' + addLib.length + ' drills, retired ' + retired + ' Jr. NBA drills, added ' + addPlan.length + ' plan rows.';
  v2BumpCache();
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

// ------------------------------------------------------------
// CALENDAR HEADER (2026-10-13): today's and tomorrow's events shown at the
// top of each player's hub. Display only — nothing is added to the tracks.
//   - Shows EVERYTHING (titles, times, locations) from the family calendars
//     plus both kids' team calendars — Kyle's call (2026-10-13), knowing the
//     API URL is public.
//   - Only players with something in the Players tab "Calendars" column get
//     the strip, so friends' links (Titus, Tatum) never see family events.
// ------------------------------------------------------------
var V2_NAME_MATCH_CALS = [
  'kyleedwardhoegh@gmail.com',
  'loganhoegh@gmail.com',
  'family15716951609174210844@group.calendar.google.com',
  'rpld6sdps6l5trpdmsl1r56h12phcccv@import.calendar.google.com' // Crossbar
];
var V2_TEAM_CALS = {
  'Nellie': 'rk859ieslvn83ql5tfr1c8ru4utqa794@import.calendar.google.com', // OMGBA 7th Girls 1
  'Nash': '0hjeajmuvq49iccobne38jc3mp6516jp@import.calendar.google.com'    // OMGBA 5th Boys 1
};

// Run ONCE: adds the Calendars column, fills in the team calendars, and
// prompts for Calendar permission. Then Deploy → Manage deployments → New version.
function v2SetupCalendars() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(V2_PLAYERS);
  var data = sh.getDataRange().getValues(), h = data[0];
  var col = h.indexOf('Calendars');
  if (col === -1) { col = h.length; sh.getRange(1, col + 1).setValue('Calendars').setFontWeight('bold'); }
  for (var i = 1; i < data.length; i++) {
    var team = V2_TEAM_CALS[data[i][0]];
    if (team && !String(data[i][col] || '').trim()) sh.getRange(i + 1, col + 1).setValue(team);
  }
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var lines = ['Nellie', 'Nash'].map(function (p) {
    var ev = v2Events(p, V2_TEAM_CALS[p] ? [V2_TEAM_CALS[p]] : [], today, true);
    return p + ': ' + (ev.length ? ev.map(function (e) { return e.day + ' ' + (e.time || 'all day') + ' ' + e.title; }).join('; ') : 'nothing today or tomorrow');
  });
  var msg = 'Calendars connected.\n\n' + lines.join('\n');
  v2BumpCache();
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

function v2CleanTitle(t) {
  t = String(t || '').trim();
  var m = t.match(/^(\S+)\s+-\s+(.*)$/); // "7G1 - 7G1 Practice" → "7G1 Practice"
  if (m && m[2].indexOf(m[1]) === 0) t = m[2];
  return t;
}

function v2Events(player, ownCals, date, noCache) {
  var cache = CacheService.getScriptCache(), ck = 'ev|' + player + '|' + date;
  if (!noCache) { var hit = cache.get(ck); if (hit) return JSON.parse(hit); }
  var tz = Session.getScriptTimeZone();
  var p = date.split('-'), start = new Date(+p[0], +p[1] - 1, +p[2]), end = new Date(+p[0], +p[1] - 1, +p[2] + 2);
  var out = [], seen = {};
  function add(calId) {
    var cal = null;
    try { cal = CalendarApp.getCalendarById(calId); } catch (e) {}
    if (!cal) return;
    cal.getEvents(start, end).forEach(function (ev) {
      var title = ev.getTitle();
      var s = ev.getStartTime(), allDay = ev.isAllDayEvent();
      var dayStr = Utilities.formatDate(s, tz, 'yyyy-MM-dd');
      if (allDay && dayStr < date) dayStr = date;
      var key = v2CleanTitle(title) + '|' + s.getTime();
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        day: dayStr === date ? 'Today' : 'Tomorrow',
        time: allDay ? '' : Utilities.formatDate(s, tz, 'h:mm a'),
        title: v2CleanTitle(title),
        location: String(ev.getLocation() || '').trim(),
        sort: (dayStr === date ? 0 : 1) * 1e13 + (allDay ? 0 : s.getTime() % 1e13)
      });
    });
  }
  var ids = ownCals.concat(V2_NAME_MATCH_CALS, Object.keys(V2_TEAM_CALS).map(function (k) { return V2_TEAM_CALS[k]; }));
  ids.filter(function (id, i) { return ids.indexOf(id) === i; }).forEach(function (id) { add(id); });
  out.sort(function (a, b) { return a.sort - b.sort; });
  out = out.slice(0, 16).map(function (e) { return { day: e.day, time: e.time, title: e.title, location: e.location }; });
  cache.put(ck, JSON.stringify(out), 600);
  return out;
}

// Calendar strip for the hub header; never lets a calendar problem break the hub.
// ---- Calendar credit (2026-10-14) ----
// A library row with text in "Calendar Match" (e.g. MBT) becomes a must-do on any day the
// player's calendar has an event whose title contains that text. If the title names a
// player ("Nellie MBT ..."), only that player gets it; if it names nobody, everyone does.
// Its track comes from the row's Tracks column, its points from Points Per Set.
function v2CalendarTodos(data, p, events) {
  var rules = (data.lib || []).filter(function (a) {
    return a['ID'] !== '' && v2Truthy(a['Active']) && String(a['Calendar Match'] || '').trim();
  });
  if (!rules.length || !events || !events.length) return [];
  var me = String(p['Player']), mine = v2List(p['Tracks']);
  var names = (data.players || []).map(function (x) { return String(x['Player'] || ''); }).filter(String);
  var out = [];
  rules.forEach(function (a) {
    var match = String(a['Calendar Match']).trim().toLowerCase();
    var ev = events.filter(function (e) {
      var t = String(e.title || '').toLowerCase();
      if (e.day !== 'Today' || t.indexOf(match) === -1) return false;
      var words = t.split(/[^a-z0-9]+/);
      var named = names.filter(function (n) { return words.indexOf(n.toLowerCase()) > -1; });
      return !named.length || named.indexOf(me) > -1;
    })[0];
    var track = v2List(a['Tracks']).filter(function (t) { return mine.indexOf(t) > -1; })[0];
    if (!ev || !track) return;
    var it = v2Item(a);
    it.perSet = 'On the calendar' + (ev.time ? ' at ' + ev.time : ' today');
    it.calendar = true;
    out.push({ track: track, item: it });
  });
  return out;
}

// Put calendar to-dos at the top of their track's must-dos (and out of the options).
function v2ApplyTodos(tracks, todos) {
  (todos || []).forEach(function (td) {
    var t = tracks[td.track];
    if (!t) return;
    t.options.forEach(function (g) { g.items = g.items.filter(function (x) { return x.id !== td.item.id; }); });
    t.options = t.options.filter(function (g) { return g.items.length; });
    if (!t.must.some(function (x) { return x.id === td.item.id; })) t.must.unshift(td.item);
  });
}

// Run ONCE: adds the "Calendar Match" column and the MBT library row (10 points). Safe to re-run.
function v2CalendarCredit() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(V2_LIB);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (head.indexOf('Calendar Match') === -1) {
    sh.getRange(1, head.length + 1).setValue('Calendar Match').setFontWeight('bold');
    head.push('Calendar Match');
  }
  var ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  var added = ids.indexOf('MBT1') === -1;
  if (added) {
    var v = { 'ID': 'MBT1', 'Name': 'MBT training session', 'Category': 'Team Training', 'Tracks': 'After School',
              'Sets': 1, 'Per Set': 'Full session', 'Set Labels': 'Session done', 'Points Per Set': 10, 'Video': '',
              'Cue': 'Go hard the whole session. Coaches notice effort.', 'Result': '', 'Result Of': '',
              'Source': 'From the calendar', 'Active': true, 'Calendar Match': 'MBT' };
    sh.appendRow(head.map(function (h) { return h in v ? v[h] : ''; }));
  }
  v2BumpCache();
  try { if (v3On()) v3PublishEvents(); } catch (e) { console.error(e); }
  var msg = (added ? 'Added' : 'Already had') + ' MBT1 (MBT training session, 10 achievements) in the Activity Library.\n\n' +
            'Any calendar event with "MBT" in its title now shows up as a must-do in After School for the kid it names. ' +
            'Change the points, track or matching text in that row any time.';
  console.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function v2EventsFor(p, date) {
  var own = v2List(p['Calendars']);
  if (!own.length) return []; // friends' players: no family calendar
  try { return v2Events(p['Player'], own, date); } catch (e) { return []; }
}


// ------------------------------------------------------------
// EASY MUST-DOS + DRILL FEEDBACK (2026-10-14)
// Kyle: build the habit first. Morning and Night must-dos should take 5–10 minutes;
// After School has no must-dos, only options. The first time a kid finishes a drill,
// the app asks how many minutes it took and how hard it was (1–10); answers land in
// the "Drill Feedback" tab so points can be set from real time + difficulty.
// Track Plan gets an optional "Sets" column: on a row naming one activity, it
// overrides how many sets that drill has on that track (e.g. 2 sets of Ball Raises
// as a must-do, while the library drill still has 5).
// ------------------------------------------------------------
var V2_FEEDBACK = 'Drill Feedback';
var V2_FEEDBACK_HEADERS = ['Key', 'Player', 'Activity ID', 'Activity', 'Track', 'Minutes', 'Difficulty (1-10)', 'Date', 'Updated At'];

function v2FeedbackSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(V2_FEEDBACK);
  if (!sh) {
    sh = ss.insertSheet(V2_FEEDBACK);
    sh.getRange(1, 1, 1, V2_FEEDBACK_HEADERS.length).setValues([V2_FEEDBACK_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Which activities this player has already rated (so the app asks only once).
function v2FeedbackFor(player) {
  var out = {};
  try {
    var c = CacheService.getScriptCache(), hit = c.get('v2fb'), rows;
    if (hit) rows = JSON.parse(hit);
    else {
      rows = (v2Rows(V2_FEEDBACK) || []).map(function (r) { return { 'Player': r['Player'], 'Activity ID': String(r['Activity ID']) }; });
      try { c.put('v2fb', JSON.stringify(rows), 600); } catch (e) {}
    }
    rows.forEach(function (r) { if (r['Player'] === player) out[String(r['Activity ID'])] = true; });
  } catch (e) {}
  return out;
}

function v2SetFeedback(d) {
  var minutes = Number(d.minutes), diff = Number(d.difficulty);
  if (!d.player || !d.activity || !(minutes > 0) || !(diff >= 1 && diff <= 10)) return { error: 'bad request' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = v2FeedbackSheet();
    var lib = v2Rows(V2_LIB) || [];
    var a = lib.filter(function (x) { return String(x['ID']) === String(d.activity); })[0];
    var key = d.player + '|' + d.activity;
    var row = [key, d.player, d.activity, a ? a['Name'] : '', d.track || '', minutes, Math.round(diff), d.date || '', new Date()];
    var hit = sh.getRange('A:A').createTextFinder(key).matchEntireCell(true).findNext();
    if (hit) sh.getRange(hit.getRow(), 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    try { CacheService.getScriptCache().remove('v2fb'); } catch (e) {}
    v3Forward('feedback', { id: key, player: d.player, activity: String(d.activity), activity_name: a ? a['Name'] : null, track: d.track || null, minutes: minutes, difficulty: Math.round(diff), day: d.date || null });
    return { ok: true };
  } finally { lock.releaseLock(); }
}

// Run ONCE: short must-dos (Morning + Night), none After School, Sets column, feedback tab.
function v2EasyMustDos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var plan = ss.getSheetByName(V2_PLAN);
  if (!plan) throw new Error('Run setupV2 first.');

  var h = plan.getRange(1, 1, 1, plan.getLastColumn()).getValues()[0];
  if (h.indexOf('Sets') === -1) { plan.getRange(1, h.length + 1).setValue('Sets').setFontWeight('bold'); h.push('Sets'); }
  var c = { track: h.indexOf('Track'), act: h.indexOf('Activity'), type: h.indexOf('Type'), order: h.indexOf('Order'), active: h.indexOf('Active'), sets: h.indexOf('Sets') };

  // Short must-do lists: [activity, sets (blank = the drill's full sets)]
  var MUST = {
    'Morning': [['BC1', ''], ['BC2', 2], ['M3', ''], ['BC4', ''], ['BC7', 2]],
    'Night': [['D1', 2], ['D2', 2], ['D3', 2]],
    'After School': []
  };
  var data = plan.getDataRange().getValues(), seen = {}, changed = 0;
  for (var i = 1; i < data.length; i++) {
    var t = data[i][c.track], a = String(data[i][c.act]).trim();
    if (!MUST.hasOwnProperty(t) || data[i][c.active] === false) continue;
    seen[t + '|' + a] = true;
    var pick = MUST[t].filter(function (m) { return m[0] === a; })[0];
    if (pick) {
      plan.getRange(i + 1, c.type + 1).setValue('Must-do');
      plan.getRange(i + 1, c.order + 1).setValue(MUST[t].indexOf(pick) + 1);
      plan.getRange(i + 1, c.sets + 1).setValue(pick[1]);
      changed++;
    } else if (data[i][c.type] === 'Must-do') {
      // Everything else stays available, just not required.
      plan.getRange(i + 1, c.type + 1).setValue('Option');
      plan.getRange(i + 1, c.sets + 1).setValue('');
      changed++;
    }
  }
  var add = [];
  Object.keys(MUST).forEach(function (t) {
    MUST[t].forEach(function (m, k) {
      if (!seen[t + '|' + m[0]]) {
        var row = h.map(function () { return ''; });
        row[h.indexOf('Player')] = 'All'; row[c.track] = t; row[c.act] = m[0]; row[c.type] = 'Must-do';
        row[c.order] = k + 1; row[c.active] = true; row[c.sets] = m[1];
        add.push(row);
      }
    });
  });
  // Night: the full Dunn drills (and Shoot to Yourself) stay available as options.
  if (!seen['Night|Category: Dunn Shooting']) {
    var opt = h.map(function () { return ''; });
    opt[h.indexOf('Player')] = 'All'; opt[c.track] = 'Night'; opt[c.act] = 'Category: Dunn Shooting';
    opt[c.type] = 'Option'; opt[c.order] = 9; opt[c.active] = true;
    add.push(opt);
  }
  if (add.length) plan.getRange(plan.getLastRow() + 1, 1, add.length, h.length).setValues(add);

  v2FeedbackSheet();
  var msg = 'Easy must-dos set: ' + changed + ' plan rows updated, ' + add.length + ' added. Drill Feedback tab ready.';
  v2BumpCache();
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

// ============================================================
// v3: FAST DATABASE (Supabase), 2026-10-14
// The Sheet stays the place to edit drills, plans and prizes. This code publishes a
// computer-friendly copy of the plan into Supabase (within about a minute of an edit)
// and copies the kids' check-offs, drill ratings and bomb/thermometer picks back into
// the Sheet every 5 minutes. The website reads and writes Supabase directly (~0.2 s
// instead of 2–5 s) and falls back to this script by itself if Supabase can't be reached.
//
// One-time setup (HANDOFF "v3: fast database"):
//   1. Project Settings (gear icon) → Script properties → add
//        SUPABASE_URL         https://xxxx.supabase.co
//        SUPABASE_SECRET_KEY  the project's secret (service_role) key
//   2. Run v3Install once and approve the permissions. Safe to run again any time.
// ============================================================

function v3Cfg() {
  var p = PropertiesService.getScriptProperties();
  return {
    url: String(p.getProperty('SUPABASE_URL') || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, ''),
    key: String(p.getProperty('SUPABASE_SECRET_KEY') || '').trim()
  };
}
function v3On() { var c = v3Cfg(); return !!(c.url && c.key); }

function v3Req(method, path, body, prefer) {
  var c = v3Cfg();
  if (!c.url || !c.key) throw new Error('Add SUPABASE_URL and SUPABASE_SECRET_KEY under Project Settings → Script properties first.');
  var headers = { apikey: c.key };
  if (/^eyJ/.test(c.key)) headers.Authorization = 'Bearer ' + c.key; // older-style keys
  if (prefer) headers.Prefer = prefer;
  var opt = { method: method, headers: headers, muteHttpExceptions: true };
  if (body !== undefined) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  var res = UrlFetchApp.fetch(c.url + '/rest/v1/' + path, opt);
  var code = res.getResponseCode(), text = res.getContentText();
  if (code >= 300) throw new Error('Supabase said ' + code + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

function v3Upsert(table, rows) {
  for (var i = 0; i < rows.length; i += 500) {
    v3Req('post', table, rows.slice(i, i + 500), 'resolution=merge-duplicates,return=minimal');
  }
}

// Saves made through this script (older screens, or the website's fallback) also land
// in the database, so nothing is lost while devices switch over.
function v3Forward(table, row) {
  if (!v3On()) return;
  try { v3Upsert(table, [row]); } catch (e) { console.error('v3Forward ' + e); }
}

function v3Hash(s) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8));
}

// Upload only the documents that changed since the last upload (or all, with force).
function v3PutDocs(docs, force) {
  var props = PropertiesService.getScriptProperties();
  var changed = docs.filter(function (d) {
    d.h = v3Hash(JSON.stringify(d.data));
    return force || props.getProperty('v3h|' + d.id) !== d.h;
  });
  if (!changed.length) return 0;
  var now = new Date().toISOString();
  v3Upsert('site_data', changed.map(function (d) { return { id: d.id, data: d.data, updated_at: now }; }));
  changed.forEach(function (d) { props.setProperty('v3h|' + d.id, d.h); });
  return changed.length;
}

// The plan: player list + each active player's tracks and prizes.
function v3Publish(force) {
  if (force) v2BumpCache();
  var data = v2Data();
  if (!data.players || !data.lib || !data.plan || !data.prizes) throw new Error('The v2 tabs are missing (run setupV2).');
  var active = v2ActivePlayers(data.players);
  var docs = [{ id: 'players', data: active }];
  // Whole Activity Library (incl. drills not in any plan) for the /drills/ page.
  docs.push({ id: 'library', data: data.lib.filter(function (a) { return a['ID'] !== ''; }).map(function (a) {
    var it = v2Item(a);
    it.tracks = v2List(a['Tracks']);
    it.active = v2Truthy(a['Active']);
    it.calendarMatch = String(a['Calendar Match'] || '');
    return it;
  }) });
  active.forEach(function (ap) {
    var built = v2PlanFor(data, ap.name);
    if (!built) return;
    var prizes = data.prizes.filter(function (r) { return r['Player'] === ap.name || r['Player'] === 'All'; }).map(function (r) {
      return { player: r['Player'], type: r['Type'], prize: r['Prize'], target: Number(r['Target Points']) || 100, start: v2Ymd(r['Start Date']) };
    });
    docs.push({ id: 'plan:' + ap.name, data: {
      player: { name: built.p['Player'], tracks: built.trackNames, visual: built.p['Visual'] || 'Bomb', theme: built.p['Theme'] || '' },
      tracks: built.tracks, prizes: prizes
    } });
  });
  return v3PutDocs(docs, force);
}

// Calendar strip: today's and tomorrow's events for each player with calendars.
function v3PublishEvents() {
  var data = v2Data();
  var today = v2Ymd(new Date()), tomorrow = v2AddDays(today, 1);
  var docs = (data.players || []).filter(function (p) { return v2Truthy(p['Active']); }).map(function (p) {
    var days = {};
    days[today] = v2EventsFor(p, today);
    days[tomorrow] = v2EventsFor(p, tomorrow);
    var todos = {};
    todos[today] = v2CalendarTodos(data, p, days[today]);
    todos[tomorrow] = v2CalendarTodos(data, p, days[tomorrow]);
    return { id: 'events:' + p['Player'], data: { days: days, todos: todos } };
  });
  return v3PutDocs(docs, false);
}

// Write rows (column A = key) into a tab: update rows whose key exists, append the rest.
// Rows already up to date (same "Updated At", the last column) are skipped.
function v3WriteKeyed(sh, rows) {
  if (!rows.length) return 0;
  var width = rows[0].length, last = sh.getLastRow();
  var vals = last > 1 ? sh.getRange(2, 1, last - 1, width).getValues() : [];
  var at = {};
  vals.forEach(function (r, i) { if (r[0] !== '') at[String(r[0])] = i; });
  var updates = [], adds = [];
  rows.forEach(function (r) {
    var i = at[String(r[0])];
    if (i === undefined) { at[String(r[0])] = -1; adds.push(r); return; }
    if (i === -1) return;
    var was = vals[i][width - 1];
    if (was instanceof Date && Math.abs(was.getTime() - r[width - 1].getTime()) < 1000) return;
    vals[i] = r;
    updates.push(i);
  });
  if (updates.length > 20) sh.getRange(2, 1, vals.length, width).setValues(vals);
  else updates.forEach(function (i) { sh.getRange(i + 2, 1, 1, width).setValues([vals[i]]); });
  if (adds.length) sh.getRange(Math.max(last, 1) + 1, 1, adds.length, width).setValues(adds);
  return updates.length + adds.length;
}

// Copy one table's recent changes into its tab. Re-reads a 2-minute overlap each time so
// a save that was still finishing during the last copy is never missed.
function v3MirrorTable(table, propKey, sh, toRow) {
  var props = PropertiesService.getScriptProperties();
  var since = props.getProperty(propKey);
  var from = since ? new Date(new Date(since).getTime() - 120000).toISOString() : '1970-01-01T00:00:00Z';
  var rows = [];
  for (var off = 0; ; off += 1000) {
    var page = v3Req('get', table + '?select=*&updated_at=gte.' + encodeURIComponent(from) + '&order=updated_at.asc,id.asc&offset=' + off + '&limit=1000') || [];
    rows = rows.concat(page);
    if (page.length < 1000) break;
  }
  if (!rows.length) return 0;
  var n = v3WriteKeyed(sh, rows.map(toRow));
  props.setProperty(propKey, rows[rows.length - 1].updated_at);
  return n;
}

function v3Mirror() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var n = v3MirrorTable('set_log', 'v3since_log', ss.getSheetByName(V2_LOG), function (r) {
    return [r.id, r.day, r.player, r.track, r.activity, Number(r.set_no), Number(r.points),
            r.result === null ? '' : Number(r.result), r.done === true, new Date(r.updated_at)];
  });
  n += v3MirrorTable('feedback', 'v3since_fb', v2FeedbackSheet(), function (r) {
    return [r.id, r.player, r.activity, r.activity_name || '', r.track || '', Number(r.minutes), Number(r.difficulty),
            r.day || '', new Date(r.updated_at)];
  });
  // Bomb / thermometer picks made on the website.
  var st = v3Req('get', 'player_settings?select=player,visual') || [];
  if (st.length) {
    var sh = ss.getSheetByName(V2_PLAYERS), vals = sh.getDataRange().getValues(), col = vals[0].indexOf('Visual'), changed = false;
    st.forEach(function (s) {
      for (var i = 1; i < vals.length; i++) {
        if (vals[i][0] === s.player && s.visual && vals[i][col] !== s.visual) { sh.getRange(i + 1, col + 1).setValue(s.visual); changed = true; }
      }
    });
    if (changed) v2BumpCache();
  }
  return n;
}

// Every minute: republish the plan if the Sheet changed (onEdit / onChange bump v2gen).
function v3Tick() {
  if (!v3On()) return;
  var props = PropertiesService.getScriptProperties(), gen = v2CacheGen();
  if (props.getProperty('v3gen') === gen) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try { v3Publish(false); props.setProperty('v3gen', gen); } finally { lock.releaseLock(); }
}

// ---- Household calendar with owners (2026-10-19) ----
// Kyle: "clearly indicate which is a Logan, Kyle or both event" on the home screen.
// One 'events:home' doc: today's and tomorrow's events from every family calendar, each
// tagged with who it's for, from (1) which calendars it's on (an event on both Kyle's
// and Logan's calendars, or on the shared family calendar, is for both), (2) the guest
// list (the other parent invited = both), and (3) family names in the title.
var V3_KYLE = 'kyleedwardhoegh@gmail.com', V3_LOGAN = 'loganhoegh@gmail.com';
var V3_HOME_CALS = [
  { id: V3_KYLE, who: ['Kyle'] },
  { id: V3_LOGAN, who: ['Logan'] },
  { id: 'family15716951609174210844@group.calendar.google.com', who: ['Kyle', 'Logan'] },
  { id: 'rpld6sdps6l5trpdmsl1r56h12phcccv@import.calendar.google.com', who: [] } // Crossbar
];
var V3_FAMILY = ['Kyle', 'Logan', 'Nellie', 'Nash'];

function v3HomeEvents(date) {
  var cache = CacheService.getScriptCache(), ck = 'home|' + date;
  var hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  var tz = Session.getScriptTimeZone();
  var p = date.split('-'), start = new Date(+p[0], +p[1] - 1, +p[2]), end = new Date(+p[0], +p[1] - 1, +p[2] + 1);
  var cals = V3_HOME_CALS.concat(Object.keys(V2_TEAM_CALS).map(function (k) { return { id: V2_TEAM_CALS[k], who: [k] }; }));
  var byKey = {}, list = [];
  cals.forEach(function (c) {
    var cal = null;
    try { cal = CalendarApp.getCalendarById(c.id); } catch (e) {}
    if (!cal) return;
    cal.getEvents(start, end).forEach(function (ev) {
      var s = ev.getStartTime(), allDay = ev.isAllDayEvent(), title = v2CleanTitle(ev.getTitle());
      var key = title.toLowerCase() + '|' + (allDay ? 'all' : s.getTime());
      var e = byKey[key];
      if (!e) {
        e = byKey[key] = { title: title, time: allDay ? '' : Utilities.formatDate(s, tz, 'h:mm a'),
                           location: String(ev.getLocation() || '').trim(), sort: allDay ? 0 : s.getTime(), w: {} };
        list.push(e);
      }
      c.who.forEach(function (w) { e.w[w] = true; });
      try {
        ev.getGuestList().forEach(function (g) {
          var em = String(g.getEmail() || '').toLowerCase();
          if (em === V3_KYLE) e.w.Kyle = true;
          if (em === V3_LOGAN) e.w.Logan = true;
        });
      } catch (x) {}
      var words = title.toLowerCase().split(/[^a-z0-9]+/);
      V3_FAMILY.forEach(function (n) { if (words.indexOf(n.toLowerCase()) > -1) e.w[n] = true; });
    });
  });
  list.sort(function (a, b) { return a.sort - b.sort; });
  var out = list.slice(0, 30).map(function (e) {
    return { title: e.title, time: e.time, location: e.location, who: V3_FAMILY.filter(function (n) { return e.w[n]; }) };
  });
  try { cache.put(ck, JSON.stringify(out), 600); } catch (e) {}
  return out;
}

function v3PublishHomeEvents() {
  var today = v2Ymd(new Date()), tomorrow = v2AddDays(today, 1), days = {};
  days[today] = v3HomeEvents(today);
  days[tomorrow] = v3HomeEvents(tomorrow);
  return v3PutDocs([{ id: 'events:home', data: { days: days } }], false);
}

// Every 5 minutes: copy check-offs into the Sheet, refresh calendar events, and once an
// hour re-upload the whole plan just in case. (These calls also keep the free Supabase
// project from ever being paused for inactivity.)
function v3Sync() {
  if (!v3On()) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    try { v3Mirror(); } catch (e) { console.error('v3Mirror ' + e); }
    try { v3PublishEvents(); } catch (e) { console.error('v3PublishEvents ' + e); }
    try { v3PublishHomeEvents(); } catch (e) { console.error('v3PublishHomeEvents ' + e); }
    if (new Date().getMinutes() < 5) { try { v3Publish(true); } catch (e) { console.error('v3Publish ' + e); } }
  } finally { lock.releaseLock(); }
}

// Installable onChange trigger: also catches inserted / deleted rows, which onEdit misses.
function v3OnChange(e) { v2BumpCache(); }

// Copy everything the database doesn't have yet. Never overwrites newer website saves.
function v3ImportHistory() {
  function ids(table, idCol) {
    var have = {};
    for (var off = 0; ; off += 1000) {
      var page = v3Req('get', table + '?select=' + idCol + '&order=' + idCol + '.asc&offset=' + off + '&limit=1000') || [];
      page.forEach(function (r) { have[r[idCol]] = true; });
      if (page.length < 1000) break;
    }
    return have;
  }
  function dedupe(rows, idCol) {
    var by = {};
    rows.forEach(function (r) { by[r[idCol]] = r; });
    return Object.keys(by).map(function (k) { return by[k]; });
  }
  var haveLog = ids('set_log', 'id');
  var log = dedupe((v2Rows(V2_LOG) || []).filter(function (r) { return r['Key'] && !haveLog[String(r['Key'])]; }).map(function (r) {
    var res = r['Result'];
    return {
      id: String(r['Key']), day: v2Ymd(r['Date']), player: r['Player'], track: r['Track'], activity: String(r['Activity ID']),
      set_no: Number(r['Set']) || 0, points: Number(r['Points']) || 0,
      result: res === '' || res === null || isNaN(Number(res)) ? null : Number(res),
      done: r['Done'] === true || String(r['Done']).toUpperCase() === 'TRUE'
    };
  }), 'id');
  v3Upsert('set_log', log);

  var haveFb = ids('feedback', 'id');
  var fb = dedupe((v2Rows(V2_FEEDBACK) || []).filter(function (r) { return r['Key'] && !haveFb[String(r['Key'])]; }).map(function (r) {
    return {
      id: String(r['Key']), player: r['Player'], activity: String(r['Activity ID']), activity_name: r['Activity'] || null,
      track: r['Track'] || null, minutes: Number(r['Minutes']) || null, difficulty: Number(r['Difficulty (1-10)']) || null,
      day: r['Date'] ? v2Ymd(r['Date']) : null
    };
  }), 'id');
  v3Upsert('feedback', fb);

  var haveSt = ids('player_settings', 'player');
  var st = (v2Rows(V2_PLAYERS) || []).filter(function (p) { return p['Player'] && !haveSt[p['Player']] && p['Visual']; })
    .map(function (p) { return { player: p['Player'], visual: p['Visual'] }; });
  v3Upsert('player_settings', st);

  // Start the Sheet copy from the newest change now in the database.
  var props = PropertiesService.getScriptProperties();
  [['set_log', 'v3since_log'], ['feedback', 'v3since_fb']].forEach(function (t) {
    var top = v3Req('get', t[0] + '?select=updated_at&order=updated_at.desc&limit=1') || [];
    if (top.length && !props.getProperty(t[1])) props.setProperty(t[1], top[0].updated_at);
  });
  return { log: log.length, feedback: fb.length, settings: st.length };
}

function v3Triggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['v3Tick', 'v3Sync', 'v3OnChange'].indexOf(t.getHandlerFunction()) > -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('v3Tick').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('v3Sync').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('v3OnChange').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onChange().create();
}

// Run ONCE (safe to re-run): copies history in, publishes the plan, starts the triggers.
function v3Install() {
  v3Req('get', 'site_data?select=id&limit=1'); // fails early with a clear message if keys / SQL are missing
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var got, plans, events;
  try {
    got = v3ImportHistory();
    plans = v3Publish(true);
    events = v3PublishEvents();
    PropertiesService.getScriptProperties().setProperty('v3gen', v2CacheGen());
  } finally { lock.releaseLock(); }
  v3Triggers();
  var msg = 'Fast database is on.\n\nCopied in: ' + got.log + ' check-offs, ' + got.feedback + ' drill ratings, ' +
            got.settings + ' bomb/thermometer picks.\nPublished: ' + plans + ' plan files, ' + events + ' calendar files.\n\n' +
            'From now on: edit the Sheet as usual. The website picks up changes in about a minute, and the kids\' ' +
            'check-offs show up in the Set Log tab within 5 minutes.';
  console.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

// Optional: run to see that everything is flowing.
function v3Status() {
  var props = PropertiesService.getScriptProperties();
  var docs = v3Req('get', 'site_data?select=id,updated_at&order=id.asc') || [];
  var msg = 'Database files:\n' + docs.map(function (d) { return '  ' + d.id + '  (' + d.updated_at.slice(0, 16).replace('T', ' ') + ' UTC)'; }).join('\n') +
            '\n\nLast check-off copied to the Sheet: ' + (props.getProperty('v3since_log') || 'none yet') +
            '\nTriggers: ' + ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }).join(', ');
  console.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}
