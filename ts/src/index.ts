/// <reference path="../typings/index.d.ts" />

/*
* CLASS TASK
* settFile must be like :
{
	"coreScript": "./data/simple.sh",
	"jobsArray" : [],
	"wait" : true,
	"automaticClosure": false,
	"settings": {}
}


* Usage :
var tk = require('taskObject');
var taskTest = new tk.Task (jobManager, jobProfile);
readableStream.pipe(taskTest).pipe(writableStream);
*/


// TODO
// - git ignore node_modules
// - kill method
// - implement the writing of more than one input : this.write_inputs()



import events = require ('events');
import stream = require ('stream');
import jsonfile = require ('jsonfile');
import JSON = require ('JSON');
import fs = require ('fs');
//import {spawn} from 'child_process';
import uuid = require ('node-uuid');
import path = require ('path');
import deepEqual = require('deep-equal');


const staticTag: string = 'simple'; // must be unique


export class Task extends stream.Duplex {
	jobManager: any; // example : nslurm
	cacheDir: string; // specify a repository where to put results
	dynamicTag: string; // to identify precisely the task when it is created
	settFile: string; // settings file path
	coreScript: string; // core script path
	streamContent: string; // content of the input gived by the stream
	results: string;
	jobProfile: {} // including partition, qos, uid, gid (given by jobManager)
	jobsArray: string[]; // usefull ?
	wait: boolean; // always TRUE for now = we need to wait all the data before beginning to run
	automaticClosure: boolean;
	settings: {}; // specific to each task // usefull ?
	//private goReading: boolean; // indicate when the read function can be used
	goReading: boolean; // for tests
	private nextInput: boolean; // false when the input is not complete

	/*
	* Initialize the task parameters.
	*/
	constructor (jobManager, jobProfile: {}, taskNum?: number, options?: any) {
		if (! jobManager) throw 'ERROR : a job manager must be specified';
		if (! staticTag) throw 'ERROR : no tagTask specified in this module';
		super(options);
		this.jobManager = jobManager;
		this.cacheDir = this.jobManager.cacheDir();
		this.jobProfile = jobProfile;
		if (taskNum) this.dynamicTag = staticTag + taskNum;
		else this.dynamicTag = staticTag;
		this.streamContent = '';
		this.results = null;
		this.goReading = false;
		this.nextInput = false;
		this.settFile = __dirname + '/data/settings.json';
		this._firstSet(this._parseJson(this.settFile));
	}

	/*
	* Open a json file and return its content if no error
	*/
	_parseJson (file: string): {} {
		try {
			var dict: {} = jsonfile.readFileSync(file, 'utf8');
			return dict;
		}
		catch (err) {
			console.log('WARNING : ' + err);
			return null;
		}
	}

	/*
	* First set of the task : called by the constructor.
	* data is a literal like { 'author' : 'me', 'settings' : { 't' : 5, 'iterations' : 10 } }
	*/
	_firstSet (data: any): void {
		if (data) {
			if ('coreScript' in data) this.coreScript = __dirname + '/' + data.coreScript;
			else this.coreScript = null;
			if ('jobsArray' in data) this.jobsArray = data.jobsArray;
			else this.jobsArray = [];
			if ('wait' in data) this.wait = data.wait;
			else this.wait = true;
			if ('automaticClosure' in data) this.automaticClosure = data.automaticClosure;
			else this.automaticClosure = false;
			if ('settings' in data) this.settings = data.settings;
			else this.settings = {};
		}
	}

	/*
	* Change task parameters according to the keys in data (JSON format) :
	* data is a literal like { 'author' : 'me', 'settings' : { 't' : 5, 'iterations' : 10 } }
	*/
	set (data: any): void {
		if (data) {
			if ('cacheDir' in data) this.cacheDir = data.cacheDir;
			if ('coreScript' in data) this.coreScript = __dirname + '/' + data.coreScript;
			if ('jobsArray' in data) this.jobsArray = data.jobsArray;
			if ('wait' in data) this.wait = data.wait;
			if ('automaticClosure' in data) this.automaticClosure = data.automaticClosure;
			if ('settings' in data) {
				for (var key in data.settings) {
					if (this.settings.hasOwnProperty(key)) this.settings[key] = data.settings[key];
					else throw 'ERROR : cannot set the '+ key +' property which does not exist in this task';
				}
			}
		}
	}

	/*
	* Create the directory according to @dirPath
	*/
	createDir (dirPath: string): void {
		try { fs.mkdirSync(dirPath); }
		catch (err) { console.log('WARNING : ' + err); }
	}

	/*
	* Write the @data in the a file according to the @filePath
	*/
	writeFile (filePath: string, data: string): void {
		try { fs.writeFileSync(filePath, data); }
		catch (err) { throw err; }
	}

	/*
	* Write @dict in the @filePath with a JSON format
	*/
	writeJson (filePath: string, dict: {}): void {
		try { jsonfile.writeFileSync(filePath, dict); }
		catch (err) { throw err; }
	}	

	/*
	* According to the parameter this.automaticClosure,
	* close definitely this task or just push the string "null"
	*/
	pushClosing (): void {
		if (this.automaticClosure) this.push(null);
		else this.push('null');
	}


	/*
	* Bad method but necessary... to compare two JSON objects
	* In both JSON object, remove the variables that are using the uuid.
	* These variables are unique so JSONs cannot be compared if we don't remove them.
	*/
	deepSettingsEqual (json1: any, json2: any): boolean {
		/* for this task, only json.exportVar.inputFile is unique */
		//console.log(json1, json2);
		if (json1.exportVar.inputFile && json2.exportVar.inputFile) {
			var json1_clone = JSON.parse(JSON.stringify(json1));
			var json2_clone = JSON.parse(JSON.stringify(json2));
			delete json1_clone.exportVar.inputFile;
			delete json2_clone.exportVar.inputFile;
			if (deepEqual(json1_clone,json2_clone)) return true;
			else return false;
		} else return false;
	}


	/*
	* Check for differences between the settings of this & the settings of current
	* WARNING : settings of this must be in a JSON format contrary to the settings of 
	* current that must be a FILE (in JSON format)
	*/
	settingsEqual (settings_this: {}, settFile_current: string): boolean {
		try {
			var settings_current: {} = this._parseJson(settFile_current);
			// console.log('okokokok >>>' + settings_this + '<<< //// >>>' + settings_current + '<<<');
			if (this.deepSettingsEqual(settings_this, settings_current)) return true;
			else return false;
		}
		catch (err) {
			console.log('WARNING : ' + err);
			return false;
		}
	}

	/*
	* Check for differences between the input of this & the input of current
	*/
	inputEqual (inputFile_this: string, inputFile_current: string): boolean {
		try { var data_this: string = fs.readFileSync(inputFile_this, 'utf8'); }
		catch (err) {
			console.log ('WARNING : ' + err);
			return false;
		}
		try { var data_current: string = fs.readFileSync(inputFile_current, 'utf8'); }
		catch (e) {
			console.log('WARNING : ' + e);
			return false;
		}
		//console.log('okokokok >>>' + data_this + '<<< //// >>>' + data_current + '<<<');
		if (data_this === data_current) return true;
		else return false;
	}

	/*
	* Check for differences between the core script of this & the core script of current
	*/
	coreScriptEqual (coreScript_this: string, coreScript_current: string): boolean {
		try { var data_this: string = fs.readFileSync(coreScript_this, 'utf8'); }
		catch (err) {
			console.log('WARNING : ' + err);
			return false;
		}
		try { var data_current: string = fs.readFileSync(coreScript_current, 'utf8'); }
		catch (e) {
			console.log('WARNING : ' + e);
			return false;
		}
		//console.log('okokokok >>>' + data + '<<< //// >>>' + d + '<<<');
		if (data_this === data_current) return true;
		else return false;
	}

	/*
	* Search for ONE UNIQUE file ("target") among a list of files (filesDir_array)
	* from a "directory". Possible thanks the "regexTarget".
	*/
	searchForOneFile (directory: string, filesDir_array: string[], regexTarget: string): string {
		if (! directory) {
			console.log('WARNING in searchForOneFile() : no directory specified');
			return null;
		} else if (! filesDir_array) {
			console.log('WARNING in searchForOneFile() : no filesDir_array specified');
			return null;
		} else if (! regexTarget) {
			console.log('WARNING in searchForOneFile() : no regexTarget specified');
			return null;
		}
		if (filesDir_array.length == 0) return null;
		var fileTarget_array: string[] = filesDir_array.filter(function (file) {
			return file.match(regexTarget); // only files that match
		}).map(function (file) {
			return path.join(directory, file);
		});

		// we want only ONE file :
		if (fileTarget_array.length > 1) {
			console.log('WARNING : more than one file found : ' + fileTarget_array);
			return null;
		}
		else if (fileTarget_array.length === 0) {
			console.log('WARNING : no file found in ' + directory + ' corresponding to : ' + regexTarget);
			return null;
		}
		else
			return fileTarget_array[0];
	}

	/*
	* Check if this task has already been done,
	* by checking for differences between our actual task ("this") & the finished task (called "current")
	* (using this.settingsEqual(), this.inputEqual() and this.coreScriptEqual() methods).
	* Steps :
	* 	(1) find all task directories which the task is the same type of "this" (according to tagTask)
	* 	(2) browse task directories
	* 	(3) read the content of the task directory and the input directory
	* 	(4) check the existence of the result files (.out and .err)
	* 	(5) check the existence of both parameter files (.json && _coreScript.sh) and input file
	* 	(6) compare all current task files with this task files
	*/
	_alreadyDone (jobOpt: any, data: string): string {
		var tab_taskDir = this.jobManager.findTaskDir(staticTag) // (1)
		if (tab_taskDir.length === 0) return null;
		//console.log(tab_taskDir);

		for (var i = 0; i < tab_taskDir.length; i++) { // (2)
			var current_taskDir: string = tab_taskDir[i];
		 	var current_inputDir: string = current_taskDir + '_inputs'; // path of the input directory
			var basename: string = path.basename(current_taskDir); // basename = tagTask + 'Task_' + uuid
			var re_outFile: string = basename + '.out';
			var re_errFile: string = basename + '.err';
			var re_json: string = basename + '_jobOpt.json';
			var re_coreScript: string = basename + '_coreScript.sh';
			var re_input: string = basename + '.txt';
			var current_outFile: string = null;
			var current_errFile: string = null;
			var current_jsonFile: string = null;
			var current_coreScriptFile: string = null;
			var current_inputFile: string = null;
			console.log('basename : ' + basename); // toto = simpleTask_98cb27cb-a0cd-40be-9e39-57ee16256a78

			try { var files_taskDir = fs.readdirSync(current_taskDir); } // read content of the task directory (3)
			catch (err) {
				console.log('WARNING : ' + err);
				if (i === tab_taskDir.length-1) return null;;
			}
			try { var files_inputDir = fs.readdirSync(current_inputDir); } // read content of the input directory (3)
			catch (e) {
				console.log('WARNING : ' + e);
				if (i === tab_taskDir.length-1) return null;
			}

			// check the existence of the .out and .err files before anything else (4)
			current_outFile = this.searchForOneFile(current_taskDir, files_taskDir, re_outFile);
			current_errFile = this.searchForOneFile(current_taskDir, files_taskDir, re_errFile);
			if (!current_outFile || !current_errFile) {
				if (i === tab_taskDir.length-1) return null;
			}
			else if (this._parseJson(current_outFile) === null) { // if the out file is not a JSON file
				if (i === tab_taskDir.length-1) return null;
			}
			
			// search for the json, _coreScript.sh and input files (5)
			current_jsonFile = this.searchForOneFile(current_inputDir, files_inputDir, re_json);
			current_coreScriptFile = this.searchForOneFile(current_taskDir, files_taskDir, re_coreScript);
			current_inputFile = this.searchForOneFile(current_inputDir, files_inputDir, re_input);

			if (current_jsonFile && current_coreScriptFile && current_inputFile) { // (6)
				if (this.settingsEqual(jobOpt.specific, current_jsonFile)) {
					if (this.coreScriptEqual(this.coreScript, current_coreScriptFile)) {
						if (this.inputEqual(jobOpt.specific.exportVar.inputFile, current_inputFile)) {
							console.log('FOUND : ' + basename);
							return current_taskDir;
						} else {
							if (i === tab_taskDir.length-1) return null;
						}
					} else {
						if (i === tab_taskDir.length-1) return null;
					}
				} else {
					if (i === tab_taskDir.length-1) return null;
				}
			} else if (i === tab_taskDir.length-1) return null;
		}
	}


	/*
	* With a key, find the path to the folder containing the results & call restoreByPath()
	* WARNING : not implemented
	*/
	// restoreByKey (key: string): any {
	// 	if (!key) throw 'ERROR : no key specified';
	// 	var path: string;
	// 	return this.restoreByPath(path);
	// }

	/*
	* With a path, restore a session
	*/
	restoreByPath (pathDir: string): string {
		if (!pathDir) throw 'ERROR : no path specified';
		var basename: string = path.basename(pathDir);
		try { var results: string = fs.readFileSync(pathDir + '/' + basename + '.out', 'utf8'); }
		catch (err) {
			throw err;
		}
		//console.log(pathDir + '/' + basename + '.out');
        return results;
	}


	/*
	* DO NOT MODIFY
	* Pre-processing of the job.
	* Configure the dictionary to pass to the jobManager.push() function, according to :
	* 	(1) the list of the modules needed
	* 	(2) variables to export in the coreScript
	* 	(3) the profile of our configuration (arwen/arwen-dev, etc.)
	* 	(4) the "mode" (must be "cpu" or "gpu")
	* This dictionary is composed of :
	* 	- a "generic" part = include parameters that will not change the results of the task
	* 	- a "specific" part = for parameters needed to define precisely the task
	*/
	configJob (modules: string[], exportVar: {}, mode: string): Object {
	    var jobOpt = {
	    	'generic' : {
	    		'id' : <string> staticTag + 'Task_' + uuid.v4(),
	    		'tWall' : <string> '0-00:15',
	    		'nCores' : <number> null
	    	},
	        'specific' : {
	        	'script' : <string> this.coreScript,
	        	'modules' : <[string]> [], // (1)
	        	'exportVar' : <{}> exportVar // (2)
	        }
	    };
	    if (modules.length > 0) jobOpt.specific.modules.concat(modules);
	    jobOpt.specific.exportVar['inputFile'] = this.cacheDir + '/' + jobOpt.generic.id + '_inputs/' + jobOpt.generic.id + '.txt';
	    // according to our configuration (3)
	    if (this.jobProfile !== null)
	    	for (var key in this.jobProfile)
	    		jobOpt.generic[key] = this.jobProfile[key];
	    // parameters depending to the mode (4)
	    if (mode === 'gpu') {
	        jobOpt.generic.nCores = 1;
	        jobOpt.generic['gres'] = 'gpu:1';
	    } else if (mode === 'cpu') {
	        jobOpt.generic.nCores = 1;
	        // no gres option on CPU
	    } else {
	        console.log("WARNING in configJob : mode not recognized. It must be \"cpu\" or \"gpu\" !");
	    }
	    return jobOpt;
	}


	/*
	* Use the values in @jsonValue [literal] to configure modules and exportVar for configJob.
	* And prepare the directories and files for the task : JSON (settings) & input(s).
	*/
	prepareTask (jsonValue: any): Object {
		var modules: string[] = []
		var exportVar: {} = {};
		var jobOpt: any = this.configJob(modules, exportVar, 'cpu');

		var inputDir = this.cacheDir + '/' + jobOpt.generic.id + '_inputs/';
		this.createDir(inputDir); // create the input directory
		this.writeJson(inputDir + '/' + jobOpt.generic.id + '_jobOpt.json', jobOpt.specific); // write the JSON file (settings)
		// write the input file(s) :
		this.writeFile(jobOpt.specific.exportVar.inputFile, jsonValue.input);

		return jobOpt;
	}


	/*
	* DO NOT MODIFY
	* Execute all the calculations
	*/
	run (jobOpt: {}): events.EventEmitter {
		var emitter = new events.EventEmitter();

		var j = this.jobManager.push(jobOpt);
		j.on('completed', (stdout, stderr, jobObject) => {
			if(stderr) {
                stderr.on('data', buf => {
                    console.log('stderr content : ');
                    console.log(buf.toString());
                });
            }
            var results: any = {'input' : ''};
            stdout.on('data', buf => { results.input += buf.toString(); });
            stdout.on('end', () => {
            	if (typeof results !== 'string') results = JSON.stringify(results);
            	emitter.emit('jobCompletion', results, jobObject);
            });
		})
		.on('error', (e, j) => {
            console.log('job ' + j.id + ' : ' + e);
            emitter.emit('error', e, j.id);
        });
		return emitter;
	}


	/*
	* DO NOT MODIFY
	* Parse @toParse [string] to find all JSON objects into.
	* Method : look at every character in the string to find the start & the end of JSONs,
	* and then substring according to start & end indices. The substrings are finally converted into JSONs.
	* Returns in @results [literal] a list of JSON objects [@results.jsonTab] and toParse without all JSON substrings [@results.rest].
	* for tests = zede}trgt{"toto" : { "yoyo" : 3}, "input" : "tototo\ntititi\ntatata"} rfr{}ojfr
	*/
	stringToJson (toParse: string): any {
		var open: string = '{', close: string = '}';
		var jsonStart: number = -1, jsonEnd: number = -1;
		var counter: number = 0;
		var sub_toParse: string;
		var result: any = {
			"rest" : "",
			"jsonTab" : []
		};

		/*
		* Check the existence of a JSON in a string.
		* Method : search the indice of the first { in the string. Then search a } from the indice to the end of the string.
		*/
		var jsonAvailable = function (toParse: string): boolean {
			var open: string = '{', close: string = '}';
			// search the first '{'
			var first_open: number = toParse.search(open);
			if (first_open === -1) return false;
			// search a '}' from the first '{' to the end
			var next_close: number = toParse.substring(first_open).search(close);
			if (next_close === -1) return false;
			else return true;
		}

		while (jsonAvailable(toParse)) { // while we find a {
			for (var i = 0; i < toParse.length; i++) {
				//console.log(i, toParse[i]);
				if (toParse[i].match(open)) {
					if (counter === 0) jsonStart = i; // if a JSON is beginning
					counter ++;
				}
				// looking for a } only if a { was found before
				if (toParse[i].match(close) && jsonStart !== -1) {
					counter --;
					if (counter === 0) { // end of the JSON
						jsonEnd = i;
						// prepare the JSON object
						sub_toParse = toParse.substring(jsonStart, jsonEnd + 1);
						result.jsonTab.push(JSON.parse(sub_toParse));

						toParse = toParse.replace(sub_toParse, ''); // remove the part of the JSON already parsed
						jsonStart = -1, jsonEnd = -1;
					}
				}
			}
		}
		result.rest += toParse;
		return result;
	}


	/*
	* DO NOT MODIFY
	* Realize all the checks and preparations before running.
	* Steps :
	* 	(1) concatenate @chunk [string] until an input is completed (if we found JSON object(s)).
	* 	(2) then look at every JSON object we found to :
	* 		(3) prepare the task = by setting options & creating files for the task
	* 		(4) check if a previous task was already done :
	* 			(5) if yes -> restore
	* 			(6) if no -> run
	*/
	processing (chunk: string): events.EventEmitter {
		if (! chunk) throw 'ERROR : Chunk is ' + chunk; // if null or undefined
		var emitter = new events.EventEmitter();
		this.streamContent += chunk; // (1)

		var resJsonParser = this.stringToJson(this.streamContent); // (1)
		this.streamContent = resJsonParser.rest;
		var jsonTab = resJsonParser.jsonTab;
		console.log('jsonTab :');
		console.dir(jsonTab);
		console.log(this.streamContent);

		jsonTab.forEach((jsonValue, i, array) => { // (2)
			//console.log('######> i = ' + i + '<#>' + jsonValue + '<######');
			if (jsonValue === 'null' || jsonValue === 'null\n') { // if end of the stream by push(null)
				this.pushClosing();
			} else {
				var taskOpt: any = this.prepareTask(jsonValue); // (3)
				//console.log(taskOpt);
				
				var pathRestore: string = this._alreadyDone(taskOpt, jsonValue.input); // (4)
				if (pathRestore !== null) { // (5)
					console.log('Restoration process started with the path : ' + pathRestore);
					this.async(this.restoreByPath(pathRestore)).on('end', results => {
						this.goReading = true;
						this.push(results);
						emitter.emit('restored', results);
					})
				} else { // (6)
					console.log('No equal task found in previous cache directories : go running !');
					this.run(taskOpt)
					.on('jobCompletion', (results, jobObject) => {
						this.goReading = true;
						this.push(results);
						emitter.emit('processed', results);
					})
					.on('error', err => {
						emitter.emit('err');
					})
					.on('endOfStream', s => {
						emitter.emit('endOfStream');
					});
				}
			}
		});
		return emitter;
	}

	/*
	* DO NOT MODIFY
	* Necessary to use .pipe(task)
	*/
	_write (chunk: any, encoding?: string, callback?: any): Task {
		// chunk can be either string or buffer but we need a string
		if (Buffer.isBuffer(chunk)) chunk = chunk.toString();

		//console.log('>>>>> write');
		this.processing(chunk)
		.on('processed', s => {
			this.emit('processed', s);
		})
		.on('err', s => {
			this.emit('err', s);
		})
		.on('endOfStream', s => {
			this.emit('endOfStream', s);
		})
		.on('restored', s => {
			this.emit('restored', s);
		});
		callback();
		return this;
	}


	/*
	* DO NOT MODIFY
	* Necessary to use task.pipe()
	*/
	_read (size?: number): any {
		//console.log('>>>>> read');
		if (this.goReading) { // false
			//console.log('>>>>> read: this.goReading is F');
            this.goReading = false;
        }
	}

	/*
	* Try to kill the job(s) of this task
	* WARNING : not implemented
	*/
	kill (managerSettings): events.EventEmitter {
		var emitter = new events.EventEmitter();
	    this.jobManager.stop(managerSettings, this.dynamicTag)
	    .on('cleanExit', function (){
	        emitter.emit('cleanExit');
	    })
	    .on('exit', function (){
	        emitter.emit('exit');
	    })
	    .on('errScancel', function () {
	        emitter.emit('errScancel');
	    })
	    .on('errSqueue', function () {
	        emitter.emit('errSqueue');
	    });

	    //console.log(emitter);
	    return emitter;
	}



	/*
	* Make a @callback asynchronous
	*/
	async (callback: any): events.EventEmitter {
		var emitter = new events.EventEmitter;
		setTimeout(() => { emitter.emit('end', callback); }, 10);
		return emitter;
	}

}


