"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// let Shapefile = require('./Shapefile').Shapefile;
var config_1 = require("./config");
var sync_1 = require("./sync");
var geojson_1 = require("./geojson");
var geofile_1 = require("./geofile");
var shapefile_1 = require("./shapefile");
var csv_1 = require("./csv");
var argv = process.argv;
if (argv.length === 3 || (argv.length == 4 && argv[3] === '-clean')) {
    var start_1 = Date.now();
    var georepo_1 = argv[2];
    var clean_1 = argv[3] === '-clean';
    var exclude_1 = config_1.conf.exclude.map(function (str) { return new RegExp(str); });
    sync_1.FSDir.files(georepo_1, /.idx$/i, true)
        .then(function (files) {
        return clean_1 ? Promise.all(files.map(function (file) { return sync_1.FSFile.remove(file.fullpath); })) : Promise.resolve([]);
    })
        .then(function (_) {
        return sync_1.FSDir.files(georepo_1, /\.(geojson|shp|json|csv)$/i, true);
    })
        .then(function (geofiles) {
        var promises = [];
        geofiles.forEach(function (file) {
            var ext = sync_1.FSys.extname(file.fullpath).toLowerCase();
            var basename = sync_1.FSys.basename(file.fullpath);
            var fileconf = config_1.conf.indexes[basename];
            switch (ext) {
                case '.geojson':
                case '.json':
                    promises.push(geofile_1.GeofileIndexer.index(fileconf, [new geojson_1.GeojsonParser(file.fullpath)]));
                    break;
                case '.csv':
                    promises.push(geofile_1.GeofileIndexer.index(fileconf, [new csv_1.CsvParser(file.fullpath, { separator: ';' })]));
                    break;
                case '.shp':
                    promises.push(geofile_1.GeofileIndexer.index(fileconf, [new shapefile_1.ShapefileShpParser(file.fullpath), new shapefile_1.ShapefileDbfParser(file.fullpath)]));
                    break;
            }
        });
        return Promise.all(promises);
    })
        .then(function (_) {
        console.log("indexing terminated successfull in " + Math.round((Date.now() - start_1) / 100) + " secs");
        return sync_1.FSDir.files(georepo_1, /.*/, true);
    })
        .then(function (files) {
        var repolist = files.filter(function (file) { return !exclude_1.some(function (re) { return re.test(file.fullpath); }); });
        var upfolder = georepo_1.replace(/[\\/]+/g, '/').replace(/[^/]*$/, '');
        files.forEach(function (file) { return file.fullpath = file.fullpath.replace(/[\\/]+/g, '/').replace(upfolder, ''); });
        return sync_1.FSFile.write(georepo_1 + '.json', JSON.stringify(repolist));
    })
        .then(function (_) { return console.log("Updated repository file liste for " + georepo_1); })
        .catch(function (error) { return console.log("indexing fail while processing " + error); });
}
else {
    console.log("Usage: node " + process.argv[1] + " <repopath> [-clean]");
}
//# sourceMappingURL=index.js.map