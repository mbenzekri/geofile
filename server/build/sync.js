'use strict';
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var fs_1 = __importDefault(require("fs"));
var polyfill_1 = require("./polyfill");
polyfill_1._();
var FSFormat;
(function (FSFormat) {
    FSFormat["arraybuffer"] = "arraybuffer";
    FSFormat["text"] = "text";
})(FSFormat || (FSFormat = {}));
exports.FSFormat = FSFormat;
/**
 * File system api base class
 */
var FSys = /** @class */ (function () {
    function FSys() {
    }
    /**
     * Initialise File System API with <nbytes> bytes requested (space requested on file system)
     * @param nbytes - number of bytes requested
     * @returns a promise resolve if the granted request is ok, reject in failure
     * @description this static method initialize File system API by requesting an amount of bytes.
     *              caution ! this request may cause a prompt window to popup for user acceptance
     */
    FSys.init = function (nbytes) {
        if (nbytes > FSys.granted) {
            FSys.granted = nbytes;
        }
        return Promise.resolve(FSys.granted);
    };
    /**
     * Test if File System API is initialized if not so throws an exception
     * @throws {Error} if FS API not initialized
     */
    FSys.ready = function () {
        // for node always ready
        return;
    };
    FSys.hasDisk = function (fullname) {
        return /^[A-Za-z]:/.test(fullname);
    };
    FSys.extname = function (filename) {
        var arr = /\.[^]*$/.exec(filename);
        return arr ? arr[0] : '';
    };
    FSys.basename = function (filename) {
        var arr = /[^\\/]+$/.exec(filename);
        return arr ? arr[0] : '';
    };
    FSys.fs = null;
    FSys.granted = null;
    return FSys;
}());
exports.FSys = FSys;
/**
  * file system class for directory operations
 */
var FSDir = /** @class */ (function (_super) {
    __extends(FSDir, _super);
    function FSDir() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    // MBZ see what to do  for 
    // static get fs() { FSys.ready(); return FSys.fs; }
    /**
     * create path recursively
     * @param path - full path of the directory
     * @returns a promise that create the directory an resolve returning dirEntry (or fileError in reject case)
     * @throws {Error} if FS API not initialized
     */
    FSDir.create = function (path) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (_this.hasDisk(path))
                return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
            var names = path.split(/[\\\/]+/);
            var fullpath = '';
            names.forEach(function (sdir) {
                fullpath += (fullpath ? '/' : '') + sdir;
                var stats = fs_1.default.statSync(fullpath);
                if (stats.isFile())
                    throw new Error("FSDir.create on directory " + path + " but " + fullpath + " is a file");
                if (!stats.isDirectory()) {
                    fs_1.default.mkdirSync(fullpath);
                }
            });
            resolve();
        });
    };
    /**
     * delete path recursively
     * @param path - full path of the directory
     * @returns a promise that delete the directory an resolve in success with no result (or fileError in reject case)
     * @throws {Error} if FS API not initialized
     */
    FSDir.delete = function (path) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (_this.hasDisk(path))
                return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
            if (fs_1.default.existsSync(path) && fs_1.default.statSync(path).isDirectory()) {
                // MBZ TODO must delete all directory content recursively
                fs_1.default.rmdirSync(path);
            }
            resolve(true);
        });
    };
    /**
     * delete path recursively
     * @param path - full path of the directory
     * @returns a promise that delete the directory an resolve in success with no result (or fileError in reject case)
     * @throws {Error} if FS API not initialized
     */
    FSDir.remove = function (path) {
        return FSDir.delete(path);
    };
    /**
     * get the directory entry for path
     * @param path - full path of the directory
     * @returns a promise that read the directory an resolve in success with directory entry (or fileError in reject case)
     * @throws {Error} if FS API not initialized
     */
    FSDir.read = function (path) {
        throw new Error("FSDir.read not implemented non sense for node.js !");
    };
    /**
     * get a directory metadata for path
     * a metadata object includes the file's size (size property) and modification date and time (modificationTime)
     * @param path - full path of the directory
     * @returns a promise that read the directory an resolve in success with directory metadata (or fileError in reject case)
     * @throws {Error} if FS API not initialized
     */
    FSDir.metadata = function (path) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (_this.hasDisk(path))
                return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
            var stats = fs_1.default.statSync(path);
            return { modificationTime: stats.mtime, size: stats.size };
        });
    };
    /**
     * get a directory file map (plain Object)
     * each filename is a property and each property have a value object containing (fullpath,time,size)
     * corresponding to fullpath name, modification date/time and size of the file.
     * @param path - full path of the directory
     * @returns a promise that read the directory an resolve in success with map object (or fileError in reject case)
     * @throws {Error} - if FS API not initialized
     */
    FSDir.files = function (path, re, deep) {
        var _this = this;
        if (re === void 0) { re = /.*/; }
        if (deep === void 0) { deep = false; }
        return new Promise(function (resolve, reject) {
            if (_this.hasDisk(path))
                return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
            var stack = [path];
            var files = [];
            while (stack.length > 0) {
                var content = fs_1.default.readdirSync(stack.pop());
                content.forEach(function (filename) {
                    var fullname = path + '/' + filename;
                    var stats = fs_1.default.statSync(fullname);
                    if (stats.isFile() && re.test(fullname)) {
                        files.push({ fullpath: fullname, size: stats.size, time: stats.mtime });
                    }
                    if (deep && stats.isDirectory()) {
                        stack.push();
                    }
                    return files;
                });
            }
            resolve(files);
        });
    };
    return FSDir;
}(FSys));
exports.FSDir = FSDir;
/**
 * file system class for files operations
 */
var FSFile = /** @class */ (function (_super) {
    __extends(FSFile, _super);
    function FSFile() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    //static get fs() { FSys.ready(); return FSys.fs; }
    /**
     * write data in a file
     * @param fullname - full path name of the file
     * @param data - to write
     * @returns a promise that write the file (create if not exist) an resolve in success
     *                    with no params (or fileError in reject case)
     */
    FSFile.write = function (fullname, data, notify) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (_this.hasDisk(fullname))
                return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
            var fd = fs_1.default.openSync(fullname, 'w', null);
            var buf = data instanceof String ? Buffer.from(data) : Buffer.from(data);
            fs_1.default.write(fd, buf, function (err, written) {
                fs_1.default.closeSync(fd);
                resolve(written);
            });
        });
    };
    /**
     * read data from file
     * @param fullname - full path name of the file
     * @param format - format of the data to read as
     * @param  function to notify on progress (call with one argument onprogressevent)
     * @returns a promise that read data from file and resolve with data (or fileError in reject case)
     */
    FSFile.read = function (fullname, format, notify) {
        var _this = this;
        if (notify === void 0) { notify = function (e) { }; }
        return new Promise(function (resolve, reject) {
            if (_this.hasDisk(fullname))
                return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
            fs_1.default.readFile(fullname, (format === FSFormat.text) ? 'utf8' : null, function (err, data) {
                err ? reject(err) : (typeof data === 'string') ? resolve(data) : resolve(data.buffer);
            });
        });
    };
    /**
     * read a slice data from file
     * @param file File entry
     * @param format format of the data to read as
     * @param offset offset in byte in the file
     * @param length length of the slice to read
     */
    FSFile.slice = function (file, format, offset, length) {
        return new Promise(function (resolve, reject) {
            var buf = Buffer.alloc(length, 0);
            fs_1.default.read(file, buf, 0, length, offset, function (err, bytesread) {
                if (err) {
                    reject(err);
                }
                else if (format == FSFormat.text) {
                    resolve(buf.slice(0, bytesread).toString('utf8'));
                }
                else {
                    if (bytesread === length) {
                        resolve(buf.buffer);
                    }
                    else {
                        var target_1 = new Uint8Array(bytesread);
                        var source_1 = new Uint8Array(buf.buffer);
                        source_1.forEach(function (v, i) { return target_1[i] = source_1[i]; });
                        resolve(target_1.buffer);
                    }
                }
            });
        });
    };
    FSFile.stream = function (fullname, format, ondata) {
        var offset = 0;
        return FSFile.get(fullname)
            .then(function (file) {
            return new Promise(function (resolve, reject) {
                var loop = function () {
                    var expected = 64 * 1024;
                    FSFile.slice(file, FSFormat.arraybuffer, offset, expected)
                        .then(function (data) {
                        offset += data.byteLength;
                        try {
                            ondata && ondata(data);
                            return (data.byteLength < expected) ? resolve() : loop();
                        }
                        catch (e) {
                            return reject(new Error("error while parsing file " + fullname + " : " + e.message));
                        }
                    });
                };
                loop();
            });
        });
    };
    /**
     * get File object for full path name
     * @param fullname - full path name of the file
     * @param format - format of the data to read as
     */
    FSFile.get = function (fullname) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (_this.hasDisk(fullname))
                return reject(new Error('FSDir.get disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
            var file = fs_1.default.openSync(fullname, 'r');
            resolve(file);
        });
    };
    /**
     * remove a file
     * @param fullname - full path name of the file
     * @returns a promise that remove the file an resolve in success with no params (or fileError in reject case)
     */
    FSFile.remove = function (fullname) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (_this.hasDisk(fullname))
                return reject(new Error('FSDir.remove disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
            fs_1.default.unlinkSync(fullname);
            resolve();
        });
    };
    /**
     * remove a file
     * @param fullname - full path name of the file
     * @returns a promise that remove the file an resolve in success with no params (or fileError in reject case)
     */
    FSFile.delete = function (fullname) {
        return FSFile.remove(fullname);
    };
    /**
     * read metadata for a file
     * a metadata object includes the file's size (metadata.size) and modification date and time (metadata.modificationTime)
     * @param fullname - full path name of the file
     * @returns a promise that read the file an resolve in success with file metadata (or fileError in reject case)
     */
    FSFile.metadata = function (fullname) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (_this.hasDisk(fullname))
                return reject(new Error('FSDir.create disk selector not implemented do not use \"C:\", \"D:\" etc ...]'));
            fs_1.default.stat(fullname, function (err, stats) { return err ? resolve(null) : resolve({ modificationTime: stats.mtime, size: stats.size }); });
        });
    };
    FSFile.release = function (file) {
        return new Promise(function (resolve) {
            try {
                fs_1.default.closeSync(file);
            }
            catch (e) { }
            resolve();
        });
    };
    return FSFile;
}(FSys));
exports.FSFile = FSFile;
//# sourceMappingURL=sync.js.map