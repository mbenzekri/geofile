'use strict';
import fs from 'fs';
import { _ } from './polyfill';
_();

enum FSFormat {
    arraybuffer = 'arraybuffer',
    text = 'text',
}

/**
 * File system api base class
 */
export abstract class FSys {

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
        if (nbytes > FSys.granted) { FSys.granted = nbytes; }
        return Promise.resolve(FSys.granted);
    }

    /**
     * Test if File System API is initialized if not so throws an exception
     * @throws {Error} if FS API not initialized
     */
    static ready() {
        // for node always ready
        return;
    }
    static hasDisk(fullname: string) {
        return /^[A-Za-z]:/.test(fullname);
    }

    static extname(filename: string): string {
        const arr = /\.[^]*$/.exec(filename);
        return arr ? arr[0] : '';
    }
    static basename(filename:string): string {
        const arr = /[^\\/]+$/.exec(filename);
        return arr ? arr[0] : '';
    }
}

/**
  * file system class for directory operations
 */
class FSDir extends FSys {
    // MBZ see what to do  for 
    // static get fs() { FSys.ready(); return FSys.fs; }
    /**
     * create path recursively
     * @param path - full path of the directory
     * @returns a promise that create the directory an resolve returning dirEntry (or fileError in reject case)
     * @throws {Error} if FS API not initialized
     */
    static create(path: string): Promise<any> {
        return new Promise((resolve, reject) => {
            if (this.hasDisk(path)) return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
            const names = path.split(/[\\\/]+/);
            let fullpath = '';
            names.forEach( sdir => {
                fullpath+= (fullpath ?  '/' : '')  + sdir;
                const stats = fs.statSync(fullpath);
                if (stats.isFile()) throw new Error(`FSDir.create on directory ${path} but ${fullpath} is a file`);
                if (!stats.isDirectory()) { fs.mkdirSync(fullpath) }
            })
            resolve();
        })
    }

    /**
     * delete path recursively
     * @param path - full path of the directory
     * @returns a promise that delete the directory an resolve in success with no result (or fileError in reject case)
     * @throws {Error} if FS API not initialized
     */
    static delete(path: string): Promise<boolean> {
        return new Promise ((resolve,reject) => {
            if (this.hasDisk(path)) return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
            if (fs.existsSync(path) && fs.statSync(path).isDirectory()) {
                // MBZ TODO must delete all directory content recursively
                fs.rmdirSync(path);
            }
            resolve(true);
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
        throw new Error(`FSDir.read not implemented non sense for node.js !`);
    }

    /**
     * get a directory metadata for path
     * a metadata object includes the file's size (size property) and modification date and time (modificationTime)
     * @param path - full path of the directory
     * @returns a promise that read the directory an resolve in success with directory metadata (or fileError in reject case)
     * @throws {Error} if FS API not initialized
     */
    static metadata(path: string): Promise<any> {
        return new Promise ((resolve,reject) => {
            if (this.hasDisk(path)) return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
            const stats = fs.statSync(path);
            return {modificationTime: stats.mtime, size: stats.size};
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
    static files(path: string, re = /.*/, deep = false): Promise<{fullpath, string; size:number, time: Date }[]> {
        return new Promise((resolve, reject) => {
            if (this.hasDisk(path)) return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
            const stack = [path];
            const files = [];
            while (stack.length > 0) {
                const content = fs.readdirSync(stack.pop());
                content.forEach( (filename) =>  {
                    const fullname = path + '/' + filename
                    const stats= fs.statSync(fullname);
                    if(stats.isFile() && re.test(fullname)) { files.push({fullpath: fullname, size: stats.size, time: stats.mtime });  }
                    if(deep && stats.isDirectory()) { stack.push() }
                    return files;
                });
            }
            resolve(files);
        })
    }
}

/**
 * file system class for files operations
 */
class FSFile extends FSys {
    //static get fs() { FSys.ready(); return FSys.fs; }
    /**
     * write data in a file
     * @param fullname - full path name of the file
     * @param data - to write
     * @returns a promise that write the file (create if not exist) an resolve in success
     *                    with no params (or fileError in reject case)
     */
    static write(fullname: string, data: string | ArrayBuffer, notify?: Function): Promise<number> {
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

    /**
     * read data from file
     * @param fullname - full path name of the file
     * @param format - format of the data to read as
     * @param  function to notify on progress (call with one argument onprogressevent)
     * @returns a promise that read data from file and resolve with data (or fileError in reject case)
     */
    static read(fullname: string, format: FSFormat, notify = (e) => { }): Promise<string|ArrayBuffer> {
        return new Promise((resolve, reject) => {
            if (this.hasDisk(fullname)) return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
            fs.readFile(fullname,(format === FSFormat.text) ? 'utf8' : null, (err, data:string|Buffer) => {
                err ? reject(err) : (typeof data === 'string') ? resolve(data) : resolve(data.buffer)
            });
        });
    }

    /**
     * read a slice data from file
     * @param file File entry
     * @param format format of the data to read as
     * @param offset offset in byte in the file
     * @param length length of the slice to read
     */
    static slice(file: number, format: FSFormat, offset: number, length: number): Promise<string|ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const buf = Buffer.alloc(length,0);
            fs.read(file,buf,0,length,offset,(err,bytesread) => {
                if (err) {
                    reject(err);
                } else  if (format == FSFormat.text) {
                    resolve(buf.slice(0,bytesread).toString('utf8'));
                } else {
                    if (bytesread === length) {
                        resolve(buf.buffer);
                    } else {
                        const target = new Uint8Array(bytesread);
                        const source = new Uint8Array(buf.buffer);
                        source.forEach((v, i) => target[i] = source[i]);
                        resolve(target.buffer);
                    }
                    
                }
            });
        });
    }

    static stream(fullname: string,format: FSFormat,ondata: (data:string|ArrayBuffer) => void): Promise<void> {
        let offset = 0;
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

    /**
     * get File object for full path name
     * @param fullname - full path name of the file
     * @param format - format of the data to read as
     */
    static get(fullname: string): Promise<number> {
        return new Promise((resolve, reject) => {
            if (this.hasDisk(fullname)) return reject(new Error('FSDir.get disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
            const file = fs.openSync(fullname, 'r');
            resolve(file);
        });
    }

    /**
     * remove a file
     * @param fullname - full path name of the file
     * @returns a promise that remove the file an resolve in success with no params (or fileError in reject case)
     */
    static remove(fullname: string): Promise<any> {
        return new Promise((resolve, reject) => {
            if (this.hasDisk(fullname)) return reject(new Error('FSDir.remove disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
            fs.unlinkSync(fullname);
            resolve();
        });
    }

    /**
     * remove a file
     * @param fullname - full path name of the file
     * @returns a promise that remove the file an resolve in success with no params (or fileError in reject case)
     */
    static delete(fullname: string): Promise<any> {
        return FSFile.remove(fullname);
    }

    /**
     * read metadata for a file
     * a metadata object includes the file's size (metadata.size) and modification date and time (metadata.modificationTime)
     * @param fullname - full path name of the file
     * @returns a promise that read the file an resolve in success with file metadata (or fileError in reject case)
     */
    static metadata(fullname: string): Promise<{modificationTime:Date, size:number}> {
        return new Promise ((resolve,reject) => {
            if (this.hasDisk(fullname)) return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
            fs.stat(fullname,(err,stats) => err ? resolve(null) : resolve({modificationTime: stats.mtime, size: stats.size}));
        });
    }

    static release(file: number):  Promise<void> {
        return new Promise((resolve) => {
            try {
                fs.closeSync(file);
            } catch(e) {}
            resolve();
        });
    } 
}

export { FSDir, FSFile, FSFormat };
