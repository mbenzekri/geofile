'use strict';
import * as fs from 'fs';
import { _ } from './polyfill';
_();
const ISNODE = (typeof window === 'undefined');

/**
 * internal class to check updateness of synced files (DO NOT USE!)
 * stores file time and size in localStorage
 * @deprecated
 */
const SYNCMAP = new class {
    storekey = 'skrat.SYNC_FILE_INFO';
    map = {};

    constructor() {
        const strmap = localStorage.getItem(this.storekey);
        if (strmap) {
            this.map = JSON.parse(strmap, (k, v) => (k === 'time') ? new Date(v) : v);
        } else {
            this.save();
        }
    }
    get(fullname) {
        return this.map[fullname];
    }
    private save() {
        localStorage.setItem(this.storekey, JSON.stringify(this.map));
    }

    has(fullname) {
        return fullname in this.map;
    }

    updateFile(fullname, time, size) {
        const metadata = { time, size };
        Object.freeze(metadata); // avoid later modifications
        this.map[fullname] = metadata;
        this.save();
    }
    removeFile(fullname) {
        delete this.map[fullname];
        this.save();
    }
    removeDir(fullpath) {
        Object.keys(this.map).forEach((key) => { if (key.startsWith(fullpath)) { delete this.map[key]; } });
        this.save();
    }
    isUptodate(fullname, srvtime, srvsize) {
        let uptodate = false;
        if (this.has(fullname)) {
            const devtime = this.get(fullname).time;
            const devsize = this.get(fullname).size;
            // this time correction to avoid approximation issues
            srvtime.setMilliseconds(0);
            devtime.setMilliseconds(0);
            uptodate = devtime.toJSON() === srvtime.toJSON() && devsize === srvsize;
        }
        return uptodate;
    }
}();

// pour eviter les erreur de compilation
const win = (window as any);
if (win.webkitRequestFileSystem && !win.requestFileSystem) {
    win.requestFileSystem = win.webkitRequestFileSystem;
}

/**
 * Class storing download state for an ongoing file download from server
 */
class DownloadState {
    /** count of byte downloaded between this.begin and this.end timestamps */
    loaded: number;
    /** total count of byte to download (unknown when compressed) */
    total: number;
    /** start download timestamp (millisec since epoc) */
    begin: number;
    /** end download timestamp (millisec since epoc) */
    end: number;
    /** elapsed time in millisec between this.begin and this.end timestamps */
    elapsed: number;
    /** estimated left time in millisec to terminate download */
    left: number;
    /** estimated download rate in bytes per second (average) */
    rate: number;
    /** text for download state */
    status: string;

    constructor() {
        this.loaded = 0;
        this.total = 0;
        this.begin = Date.now();
        this.end = Date.now();
        this.elapsed = 0;
        this.left = 0;
        this.rate = 0;
        this.status = '';
    }

    /**
     *  percentage of loaded bytes
     */
    get loadedpc(): number { return (this.total > 0) ? Math.round(100 * this.loaded / this.total) : 0; }

    /**
       *  signal start of download
       */
    start() { this.begin = this.end = Date.now(); }
    /**
       *  signal end of download
       */
    terminate() { this.update(); }

    /**
     * update download status
     * @param status - text status to set
     */
    updateStatus(status: string) { this.status = status; }

    /**
       * update the progress state loaded and total bytes and calculate timing data.
       * loaded and total are optionals, if not present update only timing data (end/elapsed/left/rate)
       * @param loaded number of loaded bytes
       * @param total total bytes expected
       */
    update(loaded?: number, total?: number) {
        if (loaded) { this.loaded = loaded; }
        if (total) { this.total = total; }
        this.end = Date.now();
        this.elapsed = this.end - this.begin;
        this.rate = Math.ceil(this.loaded / (this.elapsed / 1000));
        this.left = Math.ceil(this.rate > 0 ? (this.total - this.loaded) * 1000 / this.rate : 0);
    }
}

/**
 * class to manage a resource download process (via XHR) and follow progress state
   * @example {
   *    let url = '/my/ressource/path/file.json'
   *    let notify = function (state) => { console.log(state.loaded);}) // see DownloadState for more state attribute
   *
   *    let dl = new Download(url, 'json', notify)
   *    dl.then((data) => {console.log('success: ', data)}.catch((err) => {console.log('faillure: ',e.message)}
   *  OR
   *    Download.download(url, 'json', notify)
   *    .then((data) => {console.log('success: ', data)}.catch((err) => {console.log('faillure: ',e.message)}
   * }
   */
class Download {
    url: string;          // url of the ressource to download
    notify: Function;     // on progress notify callback : function(state: DownloadState) {}
    resptype: string;     // expected response type ("arraybuffer","blob","document","json","text" default to blob')
    xhr: XMLHttpRequest;  // XMLHttpRequest request object
    state: DownloadState; // DownloadState object to follow xhr progress and fire notify calls

    /**
     * download a resource with notification handler
     * for params see [constructor Download]{@link Download#constructor}
     */
    static download(url, resptype, notify): Promise<any> {
        const dl = new Download(url, resptype, notify);
        return dl.process();
    }

    /**
     * @param url - url of the ressource to download
     * @param resptype - expected response type ("arraybuffer","blob","document","json","text" default to blob')
     * @param notify - on progress notify callback : function(state DownloadState):void
     */
    constructor(url: string, resptype: string = 'blob', notify: Function = () => { }) {
        this.url = url;
        this.notify = notify;
        this.resptype = resptype;
        this.xhr = null;
        this.state = null;
    }

    /**
     * run the download process and return a promise which is fullfilled in download termination
     * resolved for success and reject when failed. notify call are trigerred on download state changes
     * @returns the promise
     */
    process(): Promise<any> {
        const _this = this;
        const xhr = this.xhr = new XMLHttpRequest();
        const state = this.state = new DownloadState();

        return new Promise((resolve, reject) => {
            xhr.onprogress = function (evt) {
                if (!evt.lengthComputable) { return; }
                _this.update(evt.loaded, evt.total);
            };
            xhr.onload = function (evt) {
                const size = (xhr.responseType === 'json') ? 1 : xhr.response.size;
                _this.update(size, size, xhr.statusText);
            };
            xhr.onerror = function (evt): void {
                _this.update();
                state.terminate();
                reject(new Error(evt['message'] || 'Unable to load resource (CORS ?)'));
            };
            xhr.onabort = function (evt) {
                _this.update();
                state.terminate();
                reject(new Error('Canceled by user'));
            };
            xhr.onloadend = function () {
                _this.update(null, null, _this.url + ' reply with ' + xhr.status);
                if (xhr.status >= 400) {
                    state.terminate();
                    reject(new Error(_this.url + ' reply with ' + xhr.status));
                } else {
                    const size = (xhr.responseType === 'json') ? 1 : xhr.response.size;
                    _this.update(size, size, xhr.statusText);
                    resolve(xhr.response);
                }
            };

            xhr.open('GET', this.url, true);
            xhr.responseType = (this.resptype as XMLHttpRequestResponseType);
            state.start();
            xhr.send(null);
        });
    }
    /**
     *  call this method to abort the download
     */
    abort() {
        if (this.xhr) { this.xhr.abort(); }
        this.xhr = null;
    }
    /**
     * update the state of the download state and notify changes
     * @param loaded - numer of current loaded bytes
     * @param total - total bytes to download
     * @param status - status text
     */
    private update(loaded?: number, total?: number, status?: string) {
        this.state.update(loaded, total);
        if (status) { this.state.updateStatus(status); }
        this.notify(this.state);
    }
}

enum FSFormat {
    binarystring = 'binarystring',
    arraybuffer = 'arraybuffer',
    text = 'text',
    dataurl = 'dataurl'
}

/**
 * File system api base class
 */
abstract class FSys {

    static fs: any = null;
    static granted: number = null;

    /**
     * Initialise File System API with <nbytes> bytes requested (space requested on file system)
     * @param nbytes - number of bytes requested
     * @returns a promise resolve if the granted request is ok, reject in failure
     * @description this static method initialize File system API by requesting an amount of bytes.
     *              caution ! this request may cause a prompt window to popup for user acceptance
     */
    static init(nbytes: number): Promise<number> {
        if (ISNODE) {
            if (nbytes > FSys.granted) { FSys.granted = nbytes; }
            return Promise.resolve(FSys.granted);
        }
        if (FSys.granted >= nbytes) { return Promise.resolve(FSys.granted); }
        return new Promise((resolve, reject) => {
            (navigator as any).webkitPersistentStorage.queryUsageAndQuota((usedBytes, grantedBytes) => {
                // MBZ TODO we must do somethink if grantedbyte < nbytes (alert user ?)
                if (grantedBytes >= 0) {
                    FSys.granted = (grantedBytes === 0) ? nbytes : grantedBytes;
                    (window as any).requestFileSystem((window as any).PERSISTENT, grantedBytes, (fs) => {
                        FSys.fs = fs;
                        resolve(grantedBytes);
                    }, reject);
                } else {
                    (navigator as any).webkitPersistentStorage.requestQuota(nbytes, (gbytes) => {
                        FSys.granted = gbytes;
                        (window as any).requestFileSystem((window as any).PERSISTENT, gbytes, (fs) => {
                            FSys.fs = fs;
                            resolve(gbytes);
                        }, reject);
                    }, reject);
                }
            }, reject);
        });

    }

    /**
     * Test if File System API is initialized if not so throws an exception
     * @throws {Error} if FS API not initialized
     */
    static ready() {
        if (!ISNODE && (!FSys.fs || !FSys.fs.root || FSys.granted <= 0)) {
            throw (new Error('FS API not initialized or not supported !'));
        }
    }
    static hasDisk(fullname: string) {
        return /^[A-Za-z]:/.test(fullname);
    }

    static extname(filename: string): string {
        const arr = /\.[^]*$/.exec(filename);
        return arr ? arr[0] : '';
    }
    static basename(filename: string): string {
        const arr = /[^\\/]+$/.exec(filename);
        return arr ? arr[0] : '';
    }
}

/**
  * file system class for directory operations
 */
class FSDir extends FSys {
    static get fs() { FSys.ready(); return FSys.fs; }
    /**
     * create path recursively
     * @param path - full path of the directory
     * @returns a promise that create the directory an resolve returning dirEntry (or fileError in reject case)
     * @throws {Error} if FS API not initialized
     */
    static create(path: string): Promise<any> {
        if (ISNODE) {
            return new Promise((resolve, reject) => {
                if (this.hasDisk(path)) return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
                const names = path.split(/[\\\/]+/);
                let fullpath = '';
                names.forEach(sdir => {
                    fullpath += (fullpath ? '/' : '') + sdir;
                    const stats = fs.statSync(fullpath);
                    if (stats.isFile()) throw new Error(`FSDir.create on directory ${path} but ${fullpath} is a file`);
                    if (!stats.isDirectory()) { fs.mkdirSync(fullpath) }
                })
                resolve();
            })
        }
        return new Promise((resolve, reject) => {
            FSys.ready();
            const dive = (dentry, folders) => {
                if (folders.length === 0) { return resolve(dentry); }
                if (folders[0] === '') {
                    dive(dentry, folders.slice(1));
                } else {
                    dentry.getDirectory(folders[0], { create: true }, (de) => dive(de, folders.slice(1)), reject);
                }
            };
            dive(FSys.fs.root, path.split('/'));
        });
    }

    /**
     * delete path recursively
     * @param path - full path of the directory
     * @returns a promise that delete the directory an resolve in success with no result (or fileError in reject case)
     * @throws {Error} if FS API not initialized
     */
    static delete(path: string): Promise<boolean> {
        if (ISNODE) {
            return new Promise((resolve, reject) => {
                if (this.hasDisk(path)) return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
                if (fs.existsSync(path) && fs.statSync(path).isDirectory()) {
                    // MBZ TODO must delete all directory content recursively
                    fs.rmdirSync(path);
                }
                resolve(true);
            });
        }
        return FSDir.read(path).then((dentry) => {
            return new Promise<boolean>((resolve, reject) => {
                (dentry as any).removeRecursively(() => { SYNCMAP.removeDir(path); resolve(true); }, reject);
            });
        });
    }

    /**
     * delete path recursively
     * @param path - full path of the directory
     * @returns a promise that delete the directory an resolve in success with no result (or fileError in reject case)
     * @throws {Error} if FS API not initialized
     */
    static remove(path: string): Promise<any> {
        return FSDir.delete(path);
    }

    /**
     * get the directory entry for path
     * @param path - full path of the directory
     * @returns a promise that read the directory an resolve in success with directory entry (or fileError in reject case)
     * @throws {Error} if FS API not initialized
     */
    static read(path: string): Promise<any> {
        if (ISNODE) {
            throw new Error(`FSDir.read not implemented non sense for node.js !`);
        }
        return new Promise((resolve, reject) => {
            FSys.ready();
            const dive = (dentry, folders) => {
                if (folders.length === 0) { return resolve(dentry); }
                dentry.getDirectory(folders[0], { create: false }, (de) => dive(de, folders.slice(1)), reject);
            };
            dive(FSys.fs.root, path.split('/'));
        });
    }

    /**
     * get a directory metadata for path
     * a metadata object includes the file's size (size property) and modification date and time (modificationTime)
     * @param path - full path of the directory
     * @returns a promise that read the directory an resolve in success with directory metadata (or fileError in reject case)
     * @throws {Error} if FS API not initialized
     */
    static metadata(path: string): Promise<any> {
        if (ISNODE) {
            return new Promise((resolve, reject) => {
                if (this.hasDisk(path)) return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
                const stats = fs.statSync(path);
                return { modificationTime: stats.mtime, size: stats.size };
            });
        }
        return FSDir.read(path).then((dentry) => {
            return new Promise((resolve, reject) => {
                dentry.getMetadata(resolve, reject);
            });
        });
    }

    /**
     * get a directory file map (plain Object)
     * each filename is a property and each property have a value object containing (fullpath,time,size)
     * corresponding to fullpath name, modification date/time and size of the file.
     * @param path - full path of the directory
     * @returns a promise that read the directory an resolve in success with map object (or fileError in reject case)
     * @throws {Error} - if FS API not initialized
     */
    static files(path: string, re = /.*/, deep = false): Promise<{ fullpath, string; size: number, time: Date }[]> {
        if (ISNODE) {
            return new Promise((resolve, reject) => {
                if (this.hasDisk(path)) return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
                const stack = [path];
                const files = [];
                while (stack.length > 0) {
                    const content = fs.readdirSync(stack.pop());
                    content.forEach((filename) => {
                        const fullname = path + '/' + filename
                        const stats = fs.statSync(fullname);
                        if (stats.isFile() && re.test(fullname)) { files.push({ fullpath: fullname, size: stats.size, time: stats.mtime }); }
                        if (deep && stats.isDirectory()) { stack.push() }
                        return files;
                    });
                }
                resolve(files);
            })
        }

        return new Promise((resolve, reject) => {
            const getfilemd = (fentry: any) => {
                return new Promise((inresolve) => {
                    fentry.getMetadata((md) => {
                        inresolve({ fullpath: fentry.fullPath, time: md.modificationTime, size: md.size });
                    }, (e) => {
                        inresolve();
                    });
                });
            };
            const getdirmd = (dentry: any) => {
                const r = new Promise((inresolve) => {
                    const reader = dentry.createReader();
                    reader.readEntries((results) => {
                        const promises = [];
                        results.forEach((e) => {
                            const p = (e.isFile) ? getfilemd(e) : (e.isDirectory) ? getdirmd(e) : null;
                            promises.push(p);
                        });
                        inresolve(Promise.all(promises));
                    }, (e) => { inresolve([]); });
                });
                return r;
            };
            FSDir.read(path)
                .then((dentry) => getdirmd(dentry))
                .then((arrofarr) => {
                    const files = [];
                    if (Array.isArray(arrofarr)) {
                        arrofarr.flatten(arrofarr).forEach((item) => {
                            files.push({fullpath: item.fullpath, time: item.time, size: item.size });
                        });
                    }
                    resolve(files);
                }).catch((e) => { resolve([]); });
        });
    }
}

/**
 * file system class for files operations
 */
class FSFile extends FSys {
    static get fs() { FSys.ready(); return FSys.fs; }
    /**
     * write data in a file
     * @param fullname - full path name of the file
     * @param data - to write
     * @returns a promise that write the file (create if not exist) an resolve in success
     *                    with no params (or fileError in reject case)
     */
    static write(fullname: string, data: string | ArrayBuffer | Blob, notify?: Function): Promise<any> {
        if (ISNODE) {
            return new Promise((resolve, reject) => {
                if (this.hasDisk(fullname)) return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
                const fd = fs.openSync(fullname, 'w', null);
                const buf =  data instanceof String  ? Buffer.from(<string>data) : Buffer.from(<ArrayBuffer>data);
                fs.write(fd, buf,(err,written) => {
                    fs.closeSync(fd);
                    resolve(written);
                });
            })
        }
        return new Promise((resolve, reject) => {
            const blob = (data instanceof Blob)
                ? data
                : (typeof data === 'string')
                    ? new Blob([data], { type: 'plain/text' })
                    : new Blob([data], { type: 'application/octet-stream' });
            FSys.fs.root.getFile(fullname, { create: true }, (fentry) => {
                fentry.createWriter((fwriter) => {
                    fwriter.onwriteend = function (e) { resolve(fentry); SYNCMAP.updateFile(fullname, new Date(), blob.size); };
                    fwriter.onprogress = function (e) { if (notify) { notify(e); } };
                    fwriter.onerror = function (e) { reject(e); };
                    fwriter.write(blob);
                }, reject);
            }, reject);
        });
    }

    /**
     * read data from file
     * @param fullname - full path name of the file
     * @param format - format of the data to read as
     * @param  function to notify on progress (call with one argument onprogressevent)
     * @returns a promise that read data from file and resolve with data (or fileError in reject case)
     */
    static read(fullname: string, format: FSFormat, notify = (e) => { }): Promise<any> {
        if (ISNODE) {
            return new Promise((resolve, reject) => {
                if (this.hasDisk(fullname)) return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
                fs.readFile(fullname,(format === FSFormat.text) ? 'utf8' : null, (err, data:string|Buffer) => {
                    err ? reject(err) : (typeof data === 'string') ? resolve(data) : resolve(<ArrayBuffer>data.buffer)
                });
            });
        }
        return new Promise((resolve, reject) => {
            FSys.fs.root.getFile(fullname, { create: false }, (fentry) => {
                fentry.file((file) => {
                    const reader = new FileReader();
                    reader.onload = function (e) { resolve(this.result); };
                    reader.onerror = function (e) { reject(e); };
                    reader.onprogress = function (e) { if (notify) { notify(e); } };
                    if (format === FSFormat.binarystring) { reader.readAsBinaryString(file); }
                    if (format === FSFormat.arraybuffer) { reader.readAsArrayBuffer(file); }
                    if (format === FSFormat.dataurl) { reader.readAsDataURL(file); }
                    if (format === FSFormat.text) { reader.readAsText(file, 'utf-8'); }
                }, reject);
            }, reject);
        });
    }

    /**
     * read a slice data from file
     * @param file File entry
     * @param format format of the data to read as
     * @param offset offset in byte in the file
     * @param length length of the slice to read
     */
    static slice(file: number|File, format: FSFormat, offset: number, length: number): Promise<string|ArrayBuffer> {
        if (ISNODE) {
            return new Promise((resolve, reject) => {
                const buf = Buffer.alloc(length,0);
                fs.read(<number>file,buf,0,length,offset,(err,bytesread) => {
                    if (err) {
                        reject(err);
                    } else  if (format == FSFormat.text) {
                        resolve(buf.slice(0,bytesread).toString('utf8'));
                    } else {
                        if (bytesread === length) {
                            resolve(<ArrayBuffer>buf.buffer);
                        } else {
                            const target = new Uint8Array(bytesread);
                            const source = new Uint8Array(buf.buffer);
                            source.forEach((v, i) => target[i] = source[i]);
                            resolve(<ArrayBuffer>target.buffer);
                        }
                        
                    }
                });
            });
        }
        return new Promise((resolve, reject) => {
            const type = (format === FSFormat.text) ? 'text/plain; charset=utf-8' : 'application/octet-stream';
            const slice = (<File>file).slice(offset, offset + length, type);
            const reader = new FileReader();
            reader.onload = function (e) { resolve(this.result); };
            reader.onerror = function (e) { reject(e); };
            if (format === FSFormat.binarystring) { reader.readAsBinaryString(slice); }
            if (format === FSFormat.arraybuffer) { reader.readAsArrayBuffer(slice); }
            if (format === FSFormat.dataurl) { reader.readAsDataURL(slice); }
            if (format === FSFormat.text) { reader.readAsText(slice, 'UTF-8'); }
        });
    }

    static stream(fullname: string, format: FSFormat, ondata: (data: string | ArrayBuffer) => void): Promise<void> {
        let offset = 0;
        if (ISNODE) {
            return FSFile.get(fullname)
            .then(file => {
                return new Promise<void>((resolve, reject) => {
                    const loop = () => {
                    const expected = 64*1024;
                    FSFile.slice(file,FSFormat.arraybuffer,offset,expected)
                        .then( (data: ArrayBuffer) => {
                            offset+=data.byteLength;
                            try {
                                ondata && ondata(data);
                                return (data.byteLength < expected) ?  resolve() : loop() 
                            } catch (e) {
                              return reject(new Error(`error while parsing file ${fullname} : ${e.message}`));   
                            }
                        });
                    };
                    loop();
                });
            })    
        }
        return FSFile.get(fullname)
            .then(file => {
                return new Promise<void>((resolve, reject) => {
                    const loop = () => {
                        const expected = 64 * 1024;
                        FSFile.slice(file, FSFormat.arraybuffer, offset, expected)
                            .then((data: ArrayBuffer) => {
                                offset += data.byteLength;
                                try {
                                    ondata && ondata(data);
                                    return (data.byteLength < expected) ? resolve() : loop()
                                } catch (e) {
                                    return reject(new Error(`error while parsing file ${fullname} : ${e.message}`));
                                }
                            });
                    };
                    loop();
                });
            })
    }
    /**
     * get File object for full path name
     * @param fullname - full path name of the file
     * @param format - format of the data to read as
     */
    static get(fullname: string): Promise<any> {
        if (ISNODE) {
            return new Promise((resolve, reject) => {
                if (this.hasDisk(fullname)) return reject(new Error('FSDir.get disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
                const file = fs.openSync(fullname, 'r');
                resolve(file);
            });
        }
        return new Promise((resolve, reject) => {
            FSys.fs.root.getFile(fullname, { create: false }, (fentry) => {
                fentry.file(file => resolve(file), reject);
            }, reject);
        });
    }

    /**
     * remove a file
     * @param fullname - full path name of the file
     * @returns a promise that remove the file an resolve in success with no params (or fileError in reject case)
     */
    static remove(fullname: string): Promise<any> {
        if (ISNODE) {
            return new Promise((resolve, reject) => {
                if (this.hasDisk(fullname)) return reject(new Error('FSDir.remove disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
                fs.unlinkSync(fullname);
                resolve();
            });    
        }
        return new Promise((resolve, reject) => {
            FSys.fs.root.getFile(fullname, { create: false }, (fentry) => fentry.remove(() => {
                SYNCMAP.removeFile(fullname);
                resolve();
            }, reject), reject);
        });
    }

    /**
     * remove a file
     * @param fullname - full path name of the file
     * @returns a promise that remove the file an resolve in success with no params (or fileError in reject case)
     */
    static delete(fullname: string): Promise<any> {
        return FSFile.remove(fullname).then(() => true);
    }

    /**
     * read metadata for a file
     * a metadata object includes the file's size (metadata.size) and modification date and time (metadata.modificationTime)
     * @param fullname - full path name of the file
     * @returns a promise that read the file an resolve in success with file metadata (or fileError in reject case)
     */
    static metadata(fullname: string): Promise<any> {
        if (ISNODE) {
            return new Promise ((resolve,reject) => {
                if (this.hasDisk(fullname)) return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
                fs.stat(fullname,(err,stats) => err ? resolve(null) : resolve({modificationTime: stats.mtime, size: stats.size}));
            });
        }
        return new Promise((resolve, reject) => {
            FSys.fs.root.getFile(fullname, { create: false }, (fentry) => fentry.getMetadata(resolve, reject), reject);
        });
    }

    static release(file: number):  Promise<void> {
        if (ISNODE) {
            return new Promise((resolve) => {
                try {
                    fs.closeSync(file);
                } catch(e) {}
                resolve();
            });    
        }
        return Promise.resolve();
    }
}

/**
 * Synchronisation state for a synchronisation process (see [class Sync]{@Sync})
 */
class SyncState {
    flist = [];               // file list (see [class Sync]{@Sync})
    pattern: RegExp = /.*/;   // pattern of files to synchronize
    loaded = 0;               // number of bytes loaded (file complete)
    loading = 0;              // number of bytes loaded for unterminated files (in progress)
    wrote = 0;                // number of bytes written (file complete)
    failed = 0;               // number of bytes failed to load or write (file complete)
    total = 0;                // number total of bytes to sync for a given pattern
    files = [];               // array of files currently downloading
    // (item :{ path: <string>, filename: <string>, state: <DownloadState>} for each file)
    begin = Date.now();       // start sync date (millisec from epoc)
    end = Date.now();         // end sync date (millisec from epoc)
    elapsed = 0;              // elapsed time in millisec
    left = 0;                 // estimated time left in millisec to complete
    rate = 0;                 // estimated rate in bytes per sec
    error = '';               // text of last error
    aborted = false;          // true if sync was aborted / false otherwise

    // total bytes processed bytes loaded + bytes loading + bytes failed
    get processed() { return (this.loaded + this.loading + this.failed); }
    // percent bytes processed (bytes loaded + bytes loading + bytes failed) vs total bytes
    get processedpc() { return (this.total > 0) ? (100 * (this.loaded + this.loading + this.failed) / this.total) : 0; }
    // percent bytes written
    get wrotepc() { return (this.total > 0) ? (100 * this.wrote / this.total) : 0; }
    // percent bytes loaded
    get loadedpc() { return (this.total > 0) ? Math.round(100 * this.loaded / this.total) : 0; }
    // percent bytes en loading
    get loadingpc() { return (this.total > 0) ? (100 * this.loading / this.total) : 0; }
    // percent bytes failed
    get failedpc() { return (this.total > 0) ? (100 * this.failed / this.total) : 0; }
    // true if full sync is terminated (failed or succeded)
    get isTerminated() { return this.aborted || (this.wrote + this.failed) >= this.total; }
    // true if sync is partialy failed
    get isFailed() { return this.failed > 0; }

    /**
     * set file list and pattern file to sync and initialize time counters
     * @param flist - file list
     * @param pattern pattern of files to synchronize
     */
    list(flist: Array<any>, pattern: RegExp = /.*/) {
        this.flist = flist;
        this.pattern = pattern;
        this.loaded = this.loading = this.wrote = this.failed = this.elapsed = this.left = this.rate = 0;
        this.total = this.totalBytes();
        this.begin = this.end = Date.now();
        this.error = '';
        this.aborted = false;
    }

    /**
     * add a file in download state
     * @param path - path of the file
     * @param filename - file name
     * @param dlstate - download state of the file
     */
    fileLoading(path: string, filename: string, dlstate: DownloadState) {
        const file = this.files.find((cfile) => cfile.path === path && cfile.filename === filename);
        if (file) {
            file.state = dlstate;
        } else {
            this.files.push({ path: path, filename: filename, state: dlstate });
        }
        this.update();
    }

    /**
     * return total count to download in bytes for a given file list
     * @param flist - file list
     * @returns total count to download
     */
    totalBytes(flist?: Array<any>): number {
        if (!flist) { flist = this.flist; }
        const filename = flist[0];
        const filesize = flist[2];
        const isfile = (filesize > 0);
        const isdir = (Array.isArray(flist[3]));
        const filematch = this.pattern.test(filename);
        return (isfile && filematch) ? filesize
            : (isdir) ? flist.reduce((p, c, i, a) => (i < 3) ? 0 : p + this.totalBytes(c))
                : 0;
    }

    /**
     * add loaded bytes for a completely loaded file
     * @param bytes - number of bytes of completely loaded file to add
     * @param url - url of the file
     * @param file name
     */
    loadedB(bytes: number, url: string, filename: string) {
        this.fileLoaded(url, filename);
        this.loaded += bytes;
        this.update();
    }

    /**
     * add write bytes for a completely wrote file
     * @param bytes - number of wrote bytes
     */
    writtenB(bytes: number) {
        this.wrote += bytes;
        this.update();
    }

    /**
     * add failed bytes for a failed download or write file
     * @param bytes - number of failed bytes
     */
    failedB(bytes: number, url, filename, err) {
        this.fileLoaded(url, filename);
        this.error = err.message;
        this.failed += bytes;
        this.update();
    }

    /**
     * update sync state
     */
    private update() {
        this.loading = this.files.reduce((sum, file) => sum + file.state.loaded, 0);
        this.end = Date.now();
        this.elapsed = this.end - this.begin;
        this.rate = (this.elapsed === 0) ? 0 : Math.ceil((this.loaded + this.loading) / (this.elapsed / 1000));
        this.left = (this.rate === 0) ? 0 : Math.ceil((this.total - (this.loaded + this.loading)) * 1000 / this.rate);
    }

    /**
     * signal a file completely loaded
     * @param path - path of the file
     * @param filename - file name
     */
    private fileLoaded(path: string, filename: string) {
        const i = this.files.findIndex((file) => file.path === path && file.filename === filename);
        if (i >= 0) { this.files.splice(i, 1); }
        this.update();
    }

}

/**
 * Class for synchronizing a local directory (File System API) with a file list of files located on server
 * file list format is a JSONable array of array of 3 element or more representing a directory tree
 * element 0 : file or directory name
 * element 1 : file or directory last modification date
 * element 2 : file size in bytes (if 0 then it is a directory)
 * element 3... end of array : child of the directory (recursive representation)
 *  @example {
  * For this directory tree:
 * --------------------------
 * foo (dir)
 *  + bar (file)
 *  + bazz (file)
 *  + music (dir)
 *     + beattles.mp3 (file)
 *     + prince.mp3 (file)
 * ----------------------------
 * file list is
 * ----------------------------
 *   [
 *      "foo", "2018-09-22T20:39:43.039Z",0
 *      ["bar","2018-09-22T20:39:43.039Z", 512, null],
 *      ["bazz","2018-09-22T20:39:43.039Z", 1024, null],
 *      [
 *        "music","2018-09-22T20:39:43.039Z",0,
 *        ["beattles.mp3","2018-09-22T20:39:43.039Z", 3012126, null],
 *        ["prince.mp3","2018-09-22T20:39:43.039Z", 4145024, null]
 *      ]
 *   ]
 * }
 */


class Sync {
    flisturl: string;                  // file list url to download file list JSON
    url: string;                        // source base url on server to sync
    path: string;                       // target base dir on local device to sync
    notify: (state: SyncState) => void; // notify callback called when synchronize state changes with SyncState parameter
    pattern: RegExp;                    // only files that matches this pattern are considered
    state: SyncState;                   // synchronisation state (SyncState) of the sync process
    downloads: Array<Download>;         // list of all the Download object used for the sync process
    flist: Array<any>;                  // file list downloaded from flisturl (see example)
    resolve: (s: SyncState) => void;    // resolve callback for sync processing promise
    reject: (s: SyncState) => void;     // reject callback for sync processing promise
    filemap: object;                    // local file map for time and size
    error: string;                      // error message

    /**
     * constructor
     * @param flisturl file list url to download file list JSON
     * @param url source base url on server to sync
     * @param path target base dir on local device to sync
     * @param notify notify callback called when synchronize state changes with SyncState parameter
     * @param pattern only files that matches this pattern are considered (default to match any)
     */
    constructor(url: string, path = '/', notify = (state: SyncState) => { }, pattern = /.*/) {
        this.flisturl = url + '.json'; // file list url to download file list JSON
        this.url = url; // source base url on server to sync
        this.path = path; // target base dir on local device to sync
        this.notify = notify; // notify callback called when synchronize state changes with SyncState parameter
        this.pattern = pattern; // only files that matches this pattern are considered
        this.state = new SyncState(); // synchronisation state (SyncState) of the sync process
        this.downloads = []; // list of all the Download object used for the sync process
        this.flist = null; // file list downloaded from flisturl (see example)
        this.resolve = null; // resolve callback for sync processing promise
        this.reject = null; // reject callback for sync processing promise
        this.filemap = {}; // local file map for time and size
    }

    static init(nbytes) {
        return FSys.init(nbytes);
    }

    /**
     * run a sync process (one step call)
     * for param see Sync constructor
     */
    static synchronize(url: string, path: string, notify: (state: SyncState) => void = () => { }, pattern: RegExp = /.*/) {
        const sync = new Sync(url, path, notify, pattern);
        return sync.process();
    }
    /**
     * run the sync process
     * @returns the promise is fullfilled in sync termination resolved for success, reject when failed
     */
    process(): Promise<SyncState> {
        return new Promise((resolve, reject) => {
            FSys.ready();
            return FSDir.files(this.path)
                .then((map) => {
                    this.filemap = map;
                    const dl = new Download(this.flisturl, 'json');
                    return dl.process();
                }).then((data) => {
                    this.flist = data;
                    this.state.list(this.flist, this.pattern);
                    this.resolve = resolve;
                    this.reject = reject;
                    this._sync(this.flist, this.url, this.path);
                })
                .catch((e) => { reject(new Error('Unable to sync (cause: ' + e.message + ')')); });
        });
    }
    /**
     * Abort the whole sync process
     */
    abort() {
        this.downloads.forEach((dl) => dl.abort());
        this.error = 'aborted by user';
    }

    /**
     * calculate the total sum of bytes for a file list filtered by pattern
     * @param flist file list  on which to calculate the total sum of bytes (default to this.flist)
     * @param pattern only files that match this pattern are considered (default to match any)
     * @returns sum of bytes
     */
    totalBytes(flist = this.flist, pattern = this.pattern): number {
        flist = flist || this.flist;
        pattern = pattern || this.pattern;

        const filename = flist[0];
        const filesize = flist[2];
        const isfile = (filesize > 0);
        const isdir = (Array.isArray(flist[3]));
        const filematch = pattern.test(filename);
        return (isfile && filematch) ? filesize
            : (isdir) ? flist.reduce((p, c, i) => (i < 3) ? 0 : p + this.totalBytes(c, pattern))
                : 0;
    }

    /**
     * calculate the total sum of bytes synced of a file list filtered by pattern
     * @param flist file list on which to calculate the total sum of bytes synced (default to this.flist)
     * @param path root path prefix (default to this.path)
     * @param pattern only files that match this pattern are considered (default to match any)
     * @returns sum of bytes
      */
    syncedBytes(flist = this.flist, path = this.path, pattern = this.pattern): number {
        if (Array.isArray(flist) && flist.length >= 3) {
            const filename = flist[0];
            const filedate = new Date(flist[1]);
            const filesize = flist[2];
            const isfile = (filesize > 0);
            const isdir = (Array.isArray(flist[3]));
            const filematch = pattern.test(filename);

            // item is file/file name match pattern/file is uptodate => file is synced return file size
            if (isfile && filematch && this.isUptodate(path + '/' + filename, filedate, filesize)) {
                return filesize;
            }

            // item is directory => recursively sum subdirectories
            if (isdir) {
                return flist.reduce((p, c, i) => {
                    path = (filename === '/') ? path : path + '/' + filename;
                    return (i < 3) ? 0 : p + this.syncedBytes(c, path, pattern);
                });
            }
        }
        return 0;
    }

    /**
     * test if local file is up to date
     * @param fullname - full path and name of the file (on local device)
     * @param srvtime - server time of this file
     * @param srvsize - server size of this file
     * @returns true if <fullname> file is already synced on local device and is up to date.
     *          "up to date" meaning is size are equal and server time is older than device time)
     */
    isUptodate(fullname: string, srvtime: Date, srvsize: number): boolean {
        // if (SYNCMAP.isUptodate(fullname, srvtime, srvsize)) return true
        let uptodate = false;
        if (fullname in this.filemap) {
            const devtime = this.filemap[fullname].time;
            const devsize = this.filemap[fullname].size;
            uptodate = devtime >= srvtime && devsize === srvsize;
        }
        console.log(fullname, ' uptodate: ', uptodate ? 'YES' : 'NO');
        return uptodate;
    }

    /**
     * test if sync is terminated and if so fullfill the dedicated promise
     */
    private _fullfill() {
        if (this.state.isTerminated) {
            return this.state.isFailed ? this.reject(this.state) : this.resolve(this.state);
        }
    }

    /**
     * recursive sync processing
     */
    private _sync(flist: any[], url: string, path: string) {
        const filename = flist[0];
        const filedate = flist[1] ? new Date(flist[1]) : new Date();
        const filesize = flist[2];
        if (filesize > 0 && this.pattern.test(filename)) { this._syncfile(url, path, filename, filedate, filesize); } // Syncing a file
        if (filesize === 0 && Array.isArray(flist[3])) { this._syncdir(filename, flist, url, path); } // Syncing a directory
    }

    /**
     * recursive directory sync processing
     */
    private _syncdir(dir, flist, url, path) {
        const next = (dir === '/') ? '' : '/' + dir;
        for (let i = 3; i < flist.length; i++) { if (flist[i]) { this._sync(flist[i], url + next, path + next); } }
    }
    /**
     * file sync processing (test uptodate/download file/remove file/create dir/write file)
     */
    private _syncfile(url, path, filename, filedate, filesize) {
        let data = null;
        if (this.isUptodate(path + '/' + filename, filedate, filesize)) { // if file is uptodate, bytes are loaded and written
            this.state.loadedB(filesize, url, filename);
            this.state.writtenB(filesize);
            this.notify(this.state);
            this._fullfill();
        } else { // file is outofdate, download the file
            const restype = /\.(geojson|csv|js|json)$/.test(filename) ? 'text' : 'blob';
            const dl = new Download(url + '/' + filename, restype, (dlstate) => {
                this.downloads.push(dl);
                this.state.fileLoading(url, filename, dlstate);
                this.notify(this.state);
            });
            console.log('Loading: %s/%s', path, filename);
            return dl.process() // launch download
                .then((response) => { // update the state and create dir (promise chain)
                    data = response;
                    console.log('Loaded: %s/%s', path, filename);
                    this.state.loadedB(filesize, url, filename);
                    this.notify(this.state);
                    return FSDir.create(path).catch((e) => { });
                }).then((entry) => { // remove file
                    return FSFile.remove(path + '/' + filename).catch((e) => { });
                }).then((entry) => { // write data in file
                    console.log('Writing: %s/%s', path, filename);
                    return FSFile.write(path + '/' + filename, data);
                }).then((entry) => { // update state and fullfill if terminated
                    console.log('Wrote: %s/%s', path, filename);
                    this.state.writtenB(filesize);
                    this.notify(this.state);
                    this._fullfill();
                }).catch((e) => {
                    console.log('Failed: %s/%s', path, filename);
                    this.state.failedB(filesize, url, filename, e);
                    this.notify(this.state);
                    this._fullfill();
                });
        }
    }
}

export { Sync, Download, FSys, FSDir, FSFile, FSFormat };
