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
  return jsonResponse({ error: 'unknown action' });
}

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  if (data.action === 'markComplete') {
    markComplete(data.date, data.kid, data.exercise, data.resultValue);
    return jsonResponse({ success: true });
  }
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
