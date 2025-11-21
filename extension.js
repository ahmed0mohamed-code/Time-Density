const vscode = require('vscode');
const fs = require('fs');
const path = require('path');


/**
 * @param {vscode.ExtensionContext} context
 */
let startTime = null;
let statusBarItem = null;
const WORD_SEPARATORS = /[\t\n\r,.;:!?'"\[\]{}/*+-=<>\\()\s]+/;
let totalActiveTime = 0;
let isActive = false;
let lastActiveTime = 0;
let inactivityTimeout = null;
const IDLE_TIMEOUT_MS = 2000;

let languageStats = {};
let dataFile ='';

let wpmHistory = [];


function activate(context) {

	console.log('Congratulations, your extension "time-density-" is now active!');

	const storagePath = context.globalStorageUri.fsPath;
	if(!fs.existsSync(storagePath)){
		fs.mkdirSync(storagePath, {recursive: true});
	}
	dataFile = path.join(storagePath, 'timeData.json');
	
	loadTimeData();

	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.show();
	updateStatusBar();
	setInterval(updateStatusBar, 2000);

	// detect editing time
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
		if(event.document.uri.scheme !=='file' && event.document.uri.scheme !== 'untitled') {
			return;
		}
		const langId = event.document.languageId;
		if(!languageStats[langId]){
			languageStats[langId] = { characters: 0, words: 0};
		}

		for (const change of event.contentChanges) {
			languageStats[langId].characters += change.text.length;

			if(change.text.length > 1) {
				const words = change.text.split(WORD_SEPARATORS).filter(w => w.trim().length > 0);
				languageStats[langId].words += words.length;
			}else if(change.text.length === 1){
				if(WORD_SEPARATORS.test(change.text)) {
					languageStats[langId].words++;
				}
			}
			
		}
		
		recordActivity();

	}))

	
	// detect when vscode's window is focused.
	context.subscriptions.push(vscode.window.onDidChangeWindowState((state) => {
		if (!state.focused){
			stopTracking();
		}
	}));


	//total coding time
	context.subscriptions.push(vscode.commands.registerCommand('codetime.showTime', () => {
		const currentTotal = getRealTotalTime();
		const seconds = Math.round(currentTotal / 1000);
		const minutes = Math.floor(seconds / 60);
		const remainder = seconds % 60;

		const totalWords = Object.values(languageStats).reduce((sum,s) => sum + s.words, 0);
		const totalCharacters = Object.values(languageStats).reduce((sum, s) => sum + s.characters, 0);

		const wpm = calculateWpm(totalWords);
		const cpm = calculateCpm(totalCharacters);

		vscode.window.showInformationMessage(`Total time: ${minutes} min ${remainder} sec. Avg Rate: ${cpm} CPM / ${wpm} WPM`);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codetime.showLanguageStats', showLanguageStats));

	context.subscriptions.push(vscode.commands.registerCommand('codetime.resetStats', resetStats));
}

function startTracking() {
	if (!isActive) {
		isActive= true;
		startTime = Date.now();
		lastActiveTime = startTime;
		console.log('Tracking started...');
	}

}

function stopTracking() {
	if (isActive) {
		totalActiveTime += Date.now() - startTime;
		isActive = false;
		startTime = null;
		console.log('tracking stopped.');
		saveTimeData();
		updateStatusBar();
	}


}

function recordActivity() {
	const now = Date.now();
	if (!isActive) {
		startTracking();
	}
	lastActiveTime = now;
	// if user stop typing for 2 seconds, stop tracking
	if (inactivityTimeout) clearTimeout(inactivityTimeout);

	inactivityTimeout = setTimeout(() => {
		const idleTime = Date.now() - lastActiveTime;
		if (idleTime > IDLE_TIMEOUT_MS) {
			stopTracking();
		}
	}, IDLE_TIMEOUT_MS);
}

function getRealTotalTime(){
	let pending = 0;
	if (isActive && startTime) {
		pending = Date.now() - startTime;
	}
	return totalActiveTime + pending;
}


function calculateCpm(totalCount) {

	const activeTimeInMinutes = getRealTotalTime() / (1000 * 60);

	if (activeTimeInMinutes < 0.001 || totalCount === 0 ) {
		return 0;
	}

	return Math.round(totalCount / activeTimeInMinutes);
}

function calculateWpm(totalWords) {
	const activeTimeInMinutes = getRealTotalTime() / (1000 * 60);
	if (activeTimeInMinutes< 0.001 || totalWords === 0) {
		return 0;
	}

	return Math.round(totalWords / activeTimeInMinutes);
}

function showLanguageStats() {
	let message = '--- Language Status ---\n';
	for (const lang in languageStats) {
		const stats = languageStats[lang];

		const cpm = calculateCpm(stats.characters);
		const wpm = calculateWpm(stats.words);

		message += `${lang.toUpperCase()}: ${stats.characters} chars, ${stats.words} words\n (${cpm} CPM / ${wpm} WPM)\n`;
	}
	vscode.window.showInformationMessage(message);
}


function updateStatusBar() {
	const totalCharacters = Object.values(languageStats).reduce((sum, s) => sum + s.characters, 0);
	const totalWords = Object.values(languageStats).reduce((sum, s) => sum + s.words, 0);
	
	const cpm = calculateCpm(totalCharacters);
	const wpm = calculateWpm(totalWords);

	const liveWpm = getSmoothWpm(totalWords);

	const totalTimeMs = getRealTotalTime();
	const totalMinutes = Math.floor(totalTimeMs / (1000 * 60));

	let points = 0;
	if (wpm > 0 && totalMinutes >0) {
		points = Math.round((wpm / 50) * totalMinutes * 10);
	}

	let ratio = 0;
	if (totalMinutes > 0) {
		ratio = liveWpm /  50;
	}

	if (statusBarItem) {
		statusBarItem.text = `|$(star) ${points} Pts | $(clock) ${totalMinutes}m | $(pencil) ${totalWords} Words |  $(dashboard) ${cpm} CPM / ${liveWpm} WPM`
		
		if (ratio > 1.05) {
			statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
			statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorForeground');
		}
		else if(ratio < 1.05 && ratio > 0.95 ){
			statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
			statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground')
		}
		else {
			statusBarItem.backgroundColor = undefined;
			statusBarItem.color = undefined;
		}
		statusBarItem.tooltip = `Formula: (${wpm} WPM / 50) *  ${Math.floor(totalMinutes)}m \nTotal Time: ${totalMinutes} minutes\n
		Total Chars: ${totalCharacters} chars.\n Speed: ${cpm} CPM \n Live Speed: ${liveWpm} WPM\n Target: 50 WPM`;
	}
}

function resetStats() {
	if (isActive){
		stopTracking();
	}
	totalActiveTime = 0;
	languageStats = {};
	wpmHistory = [];
	
	if(fs.existsSync(dataFile)) {
		try{
			fs.unlinkSync(dataFile);
			vscode.window.showInformationMessage('Coding stats have been completely reset.');
			updateStatusBar();
		}
		catch (e) {
			vscode.window.showErrorMessage('Error resetting stats: ' + e.message);
		}
	}
}

function saveTimeData() {
	try{
		const dataToSave = {totalActiveTime, languageStats };
		fs.writeFileSync(dataFile, JSON.stringify(dataToSave, null, 2));
	}
	catch (e) {
		console.error('Error Saving time data', e);
	}
	}
	

function loadTimeData() {
	if (fs.existsSync(dataFile)) {
		try{
			const content = fs.readFileSync(dataFile, "utf8");
			const data = JSON.parse(content);

			totalActiveTime = data.totalActiveTime || 0;
			languageStats = data.languageStats || {};

			console.log('Loaded Previous time: ', totalActiveTime);
		}
		catch (e) {
			console.error('could not parse time data file:', e)
		}
	}
}

function deactivate(){
	stopTracking();
}

function getSmoothWpm(currentTotalWords) {
	const now = Date.now();

	wpmHistory.push({time: now, words: currentTotalWords});

	const cutoff = now - 60000;
	while (wpmHistory.length > 0 && wpmHistory[0].time < cutoff) {
		wpmHistory.shift();
	}

	if (wpmHistory.length < 2) return 0;

	const oldest = wpmHistory[0];
	const newest = wpmHistory[wpmHistory.length - 1];

	const wordsDelta = newest.words - oldest.words;
	const timeDeltaMs = newest.time - oldest.time;

	if (timeDeltaMs < 1000) return 0;

	const minutes = timeDeltaMs / (1000 * 60);
	return Math.round(wordsDelta / minutes);
}

module.exports = {activate, deactivate};
