"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
var fs = __importStar(require("fs"));
function walk(dir, done) {
    var results = [];
    fs.readdir(dir, function (err, list) {
        if (err) {
            return done(err);
        }
        var i = 0;
        (function next() {
            var file = list[i++];
            if (!file) {
                return done(null, results);
            }
            file = dir + '/' + file;
            fs.stat(file, function (e1, stat) {
                if (stat && stat.isDirectory()) {
                    walk(file, function (e2, res) {
                        results = results.concat(res);
                        next();
                    });
                }
                else {
                    if (/\.(geojson|shp|json|csv)$/.test(file)) {
                        results.push(file);
                    }
                    next();
                }
            });
        })();
    });
}
exports.walk = walk;
function fstree(trunc, dir, rec, exclude, done) {
    var results = [dir, null, 0];
    fs.readdir(trunc + '/' + dir, function (err, list) {
        if (err) {
            return done(err);
        }
        var pending = list.length;
        if (!pending) {
            return done(null, results);
        }
        list.forEach(function (file) {
            var autorise = !exclude.reduce(function (res, expr) { return res || (file.search(expr) > -1); }, false);
            var stat = fs.statSync(trunc + '/' + dir + '/' + file);
            if (stat && stat.isDirectory() && rec) {
                fstree(trunc + '/' + dir, file, rec, exclude, function (e, res) {
                    if (autorise) {
                        results.push(res);
                    }
                    if (!--pending) {
                        done(null, results);
                    }
                });
            }
            else {
                if (stat) {
                    if (autorise) {
                        results.push([file, stat.mtime, stat.size, null]);
                    }
                }
                else {
                    console.log('Unable to stat file : %s/%s/%s [%s]', trunc, dir, file, err);
                }
                if (!--pending) {
                    done(null, results);
                }
            }
        });
    });
}
function writefileList(trunc, rec, dest, exclude) {
    fstree(trunc, '/', rec, exclude, function (err, tree) {
        if (err) {
            console.log(err);
        }
        var data = tree ? tree : [];
        fs.writeFile(dest, JSON.stringify(data), {}, function (e) {
            if (e) {
                console.log(e);
            }
            else {
                console.log("Updated " + trunc + " file list for download into " + dest);
            }
        });
    });
}
exports.writefileList = writefileList;
//# sourceMappingURL=syncws.js.map