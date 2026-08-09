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
  var asg = ss.getSheetByName(ASSIGNMENTS_SHEET) || ss.insertSheet(ASSIGNMENTS_SHEET);
  asg.clear();
  asg.getRange(1, 1, 1, 5).setValues([['Date', 'Kid', 'Exercise Name', 'Sets', 'Reps']]);
  asg.getRange(1, 1, 1, 5).setFontWeight('bold');
  asg.getRange(2, 2, 1000, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ASSIGNMENT_KID_OPTIONS, true).build()
  );
  asg.getRange(2, 3, 1000, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(lib.getRange('A2:A500'), true).build()
  );
  asg.setColumnWidths(1, 5, 150);

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
  var log = sheetToObjects(ss.getSheetByName(LOG_SHEET));

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
  // expand it into one entry per kid so completion is still tracked
  // independently (Nash finishing doesn't check off Nellie's box).
  var expanded = [];
  todays.forEach(function (a) {
    if (a['Kid'] === 'Both') {
      KIDS.forEach(function (k) {
        var copy = {};
        for (var key in a) copy[key] = a[key];
        copy['Kid'] = k;
        expanded.push(copy);
      });
    } else {
      expanded.push(a);
    }
  });

  return expanded.map(function (a) {
    var lib = libByName[a['Exercise Name']] || {};
    var completed = log.find(function (l) {
      var ld = new Date(l['Date']);
      ld.setHours(0, 0, 0, 0);
      return (
        ld.getTime() === targetDate.getTime() &&
        l['Kid'] === a['Kid'] &&
        l['Exercise Name'] === a['Exercise Name'] &&
        l['Done'] === true
      );
    });
    return {
      date: a['Date'],
      kid: a['Kid'],
      exercise: a['Exercise Name'],
      sets: a['Sets'],
      reps: a['Reps'],
      youtubeLink: lib['YouTube Link'] || '',
      category: lib['Category'] || '',
      resultType: lib['Result Type'] || 'None',
      done: !!completed,
      resultValue: completed ? completed['Result Value'] : null
    };
  });
}

function markComplete(dateStr, kid, exercise, resultValue) {
  var log = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET);
  var data = log.getDataRange().getValues();
  var d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);

  for (var i = 1; i < data.length; i++) {
    var rd = new Date(data[i][0]);
    rd.setHours(0, 0, 0, 0);
    if (rd.getTime() === d.getTime() && data[i][1] === kid && data[i][2] === exercise) {
      log.getRange(i + 1, 4).setValue(true);
      log.getRange(i + 1, 5).setValue(resultValue || '');
      log.getRange(i + 1, 6).setValue(new Date());
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
