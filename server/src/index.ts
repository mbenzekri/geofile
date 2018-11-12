
import { conf } from './config';
import * as gf from 'geofile';

const argv = process.argv
if (argv.length === 3 || (argv.length == 4 && argv[3] === '-clean')) {
    const start = Date.now();
    const georepo = argv[2];
    const clean = argv[3] === '-clean';
    const exclude = conf.exclude.map(str => new RegExp(str));

    gf.FSDir.files(georepo, /.idx$/i, true)
        .then(files => {
            return clean ? Promise.all(files.map(file => gf.FSFile.remove(file.fullpath))) : Promise.resolve([]) 
        })
        .then(_ => { 
            return gf.FSDir.files(georepo, /\.(geojson|shp|json|csv)$/i, true)
        })
        .then(geofiles => {
            const promises = [];
            geofiles.forEach(file => {
                const ext = gf.FSys.extname(file.fullpath).toLowerCase();
                const basename = gf.FSys.basename(file.fullpath);
                const fileconf = conf.indexes[basename];
                switch (ext) {
                    case '.geojson':
                    case '.json':
                        promises.push(gf.GeofileIndexer.index(fileconf, [new gf.GeojsonParser(file.fullpath)]));
                        break;
                    case '.csv':
                        promises.push(gf.GeofileIndexer.index(fileconf, [new gf.CsvParser(file.fullpath, { separator: ';' })]));
                        break;
                    case '.shp':
                        promises.push(gf.GeofileIndexer.index(fileconf, [new gf.ShapefileShpParser(file.fullpath), new gf.ShapefileDbfParser(file.fullpath)]));
                        break;
                }
            });
            return Promise.all(promises);
        })
        .then(_ => {
            console.log(`indexing terminated successfull in ${Math.round((Date.now() - start) / 100)} secs`);
            return gf.FSDir.files(georepo,/.*/, true)
        })
        .then(files => {
            const repolist = files.filter(file => !exclude.some(re => re.test(file.fullpath)));
            const upfolder = georepo.replace(/[\\/]+/g,'/').replace(/[^/]*$/,'');
            files.forEach(file =>  file.fullpath = file.fullpath.replace(/[\\/]+/g,'/').replace(upfolder,'') )
            return gf.FSFile.write(georepo + '.json', JSON.stringify(repolist))
        })
        .then(_ => console.log(`Updated repository file liste for ${georepo}`))
        .catch(error => console.log(`indexing fail while processing ${error}`));
} else {
    console.log(`Usage: node ${process.argv[1]} <repopath> [-clean]`)
}
