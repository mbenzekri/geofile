import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { Download, Sync, FSDir, FSFile, FSFormat } from 'geofile';
import { TestBaseComponent } from './test-base.component';

const NBYTES = 10 * Math.pow(1024, 3);

@Component({
    selector: 'test-sync',
    templateUrl: './test-base.component.html',
    styleUrls: ['./test-base.component.css']
})

export class TestSyncComponent extends TestBaseComponent implements OnInit {
    bloburl = '/data/france/communes.shp';
    jsonurl = '/data/france.json';
    dirpath = '/GEO/TMP/aDIR';
    fullname = '/GEO/TMP/aDIR/myFile.txt';
    filedata = 'Il était une fois ...';
    syncurl = '/data/france';
    syncpath = '/GEO/FRANCE';

    ngOnInit() {
        this.addTest({ method: TestSyncComponent.prototype.syncinit, should: 'should init Sync class' });
        this.addTest({ method: TestSyncComponent.prototype.syncutf8, should: 'should get utf8 file correctly'});
        this.addTest({ method: TestSyncComponent.prototype.syncsliceutf8, should: 'should get utf8 file slice correctly'});
        this.addTest({ method: TestSyncComponent.prototype.syncgit, should: 'should sync with github repo'});
        this.addTest({ method: TestSyncComponent.prototype.dircreate, should: 'create directory'});
        this.addTest({ method: TestSyncComponent.prototype.dirread, should: 'read directory' });
        this.addTest({ method: TestSyncComponent.prototype.dirmetadata, should: 'get directory metadata' });
        this.addTest({ method: TestSyncComponent.prototype.dirdelete, should: 'delete directory' });
        this.addTest({ method: TestSyncComponent.prototype.filecreate, should: 'create file' });
        this.addTest({ method: TestSyncComponent.prototype.fileread, should: 'read file' });
        this.addTest({ method: TestSyncComponent.prototype.filemetadata, should: 'read file metadata' });
        this.addTest({ method: TestSyncComponent.prototype.filedelete, should: 'delete file' });
        this.addTest({ method: TestSyncComponent.prototype.dlblob, should: 'download binary' });
        this.addTest({ method: TestSyncComponent.prototype.dljson, should: 'download json' });
        this.addTest({ method: TestSyncComponent.prototype.synchro, should: 'synchronize' });
        super.ngOnInit();
    }

    syncinit() {
        return Sync.init(NBYTES).then((granted) => [granted]).then(this.success([10737418240]));
    }

    syncutf8() {
        return FSFile.read('/GEO/FRANCE/test_utf8.txt', FSFormat.text)
        .then(txt => {
            const obj = JSON.parse(txt);
            return Object.keys(obj).map( k => obj[k]);
        })
        .then(this.success([
            'Belarus', 'Belarus', 'Belarus', 'Republic of Belarus', null,
            'Belarus', 'روسيا البيضاء', 'বেলারুশ', 'Weißrussland', 'Belarus',
            'Bielorrusia', 'Biélorussie', 'Λευκορωσία', 'बेलारूस', 'Fehéroroszország',
            'Belarus', 'Bielorussia', 'ベラルーシ', '벨라루스', 'Wit-Rusland', 'Białoruś',
            'Bielorrússia', 'Белоруссия', 'Vitryssland', 'Beyaz Rusya', 'Belarus', '白罗斯']));
    }

    syncsliceutf8() {
        return FSFile.get('/GEO/FRANCE/test_utf8.txt')
        .then(file => {
            return FSFile.slice(file, FSFormat.text, 203, 27);
        })
        .then(txt =>  JSON.parse(<string>txt))
        .then(this.success('روسيا البيضاء'));
    }

    syncgit() {
        const expected = [0, 0, 0];
        return FSDir.delete('/GEO/world')
                .catch(() => { /* ignore error */})
                .then(() => Sync.synchronize('https://mbenzekri.github.io/world/world', '/GEO/world'))
                .then((data) => {
                    expected[0] = expected[1] = expected[2] = data.total;
                    return [data.total, data.loaded, data.wrote];
                })
                .then(this.success(expected));
    }

    dircreate() {
        return FSDir.create(this.dirpath).then(r => r.fullPath).then(this.success(this.dirpath));
    }

    dirread() {
        return FSDir.read(this.dirpath).then(r => r.fullPath).then(this.success(this.dirpath));
    }

    dirmetadata() {
        return FSDir.metadata(this.dirpath).then(r => r.modificationTime != null).then(this.success(true));
    }

    dirdelete() {
        return FSDir.delete(this.dirpath).then(this.success(true));
    }

    filecreate() {
        return FSDir.create(this.dirpath).then(() =>
            FSFile.write(this.fullname, this.filedata).then(r => r.fullPath).then(this.success(this.fullname))
        );
    }

    fileread() {
        return FSFile.read(this.fullname, FSFormat.text).then(this.success(this.filedata));
    }

    filemetadata() {
        return FSFile.metadata(this.fullname).then(r => r.modificationTime != null).then(this.success(true));
    }

    filedelete() {
        return FSFile.delete(this.fullname).then(this.success(true));
    }

    dlblob() {
        const dl = new Download(this.bloburl, 'blob', (state) => { this.ref.markForCheck(); });
        return dl.process().then((data) => data.size).then(this.success(37700428)) ;
    }

    dljson() {
        const dl = new Download(this.jsonurl, 'json', (state) => { this.ref.markForCheck(); });
        return dl.process().then((data) => Array.isArray(data)).then(this.success(true));
    }

    synchro() {
        const test = () => {
            const sync = new Sync(this.syncurl, this.syncpath, (state) => { this.ref.markForCheck(); });
            return sync.process();
        };
        const expected = [0, 0, 0];
        return FSDir.delete(this.syncpath)
                .catch(() => { /* ignore error */})
                .then(test)
                .then((data) => {
                    expected[0] = expected[1] = expected[2] = data.total;
                    return [data.total, data.loaded, data.wrote];
                })
                .then(this.success(expected));
    }
}
