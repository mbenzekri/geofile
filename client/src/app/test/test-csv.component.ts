import { Component, OnInit } from '@angular/core';
import * as gf from 'geofile';
import { TestBaseComponent } from './test-base.component';

@Component({
    selector: 'test-csv',
    templateUrl: './test-base.component.html',
    styleUrls: ['./test-base.component.css']
})
export class TestCsvComponent extends TestBaseComponent implements OnInit {
    filename = '/GEO/FRANCE/adresses_92.csv';
    geofile: gf.Geofile;

    ngOnInit() {
        this.addTest({ method: TestCsvComponent.prototype.load, should: 'load: should load csv file' });
        this.addTest({ method: TestCsvComponent.prototype.foreach, should: 'forEach should count adresses of "Colombes"'});
        this.addTest({ method: TestCsvComponent.prototype.getfeature, should: 'getFeature should get the 8th feature'});
        this.addTest({ method: TestCsvComponent.prototype.getfbbox, should: 'bboxSearch should get France neighborhood' });
        this.addTest({ method: TestCsvComponent.prototype.getfpoint, should: 'pointSearch should features under point' });
        this.addTest({ method: TestCsvComponent.prototype.getfnearest, should: 'nearestSearch should get nearest features' });
        this.addTest({ method: TestCsvComponent.prototype.getfattr, should: 'attributeSearch: should get feature by attribute' });
        this.addTest({ method: TestCsvComponent.prototype.getffuzzy, should: 'attributeFuzzy: should get feature by fuzzy method' });
        this.addTest({ method: TestCsvComponent.prototype.getfprefix, should: 'prefixSearch: should get feature by prefix' });
        super.ngOnInit();
    }
    load() {
        return gf.Sync.init(10 * Math.pow(1024, 3)).then(() => {
            return gf.Csv.get(this.filename)
            .then((geofile) => {
                this.geofile = geofile;
                return [this.geofile.count, this.geofile.srs, this.geofile.style !== null,
                    this.geofile.minscale, this.geofile.maxscale, this.geofile.name, this.geofile.title, this.geofile.group];
            });
        }).then(this.success([ 180579, 'EPSG:4326', true, 0, 20000, 'Adresses', 'Departement 92 adresses', 'root' ]));
    }

    foreach() {
        let result = 0;
        return this.geofile.foreach({
            filter: (feature: gf.GeofileFeature) => feature.get('nom_commune') === 'Colombes',
            action: (feature: gf.GeofileFeature) => result++
        }).then(() => result).then(this.success(13976));
    }

    getfeature() {
        return this.geofile.getFeature(8)
            .then((feature) => [feature.get('id')])
            .then(this.success(['ADRNIVX_0000000312914792']));
    }
    getfbbox() {
        // ADRNIVX_0000000357351682 => 2 rue de versailles,92430 Marnes-la-Coquette
        return this.geofile.bboxSearch([2.17426, 48.82987, 2.17428, 48.82988])
        .then(features => features.map((c) => c.get('id')))
        .then(this.success('ADRNIVX_0000000357351682'));
    }

    getfpoint() {
        return this.geofile.pointSearch(2.17427507927158, 48.8298733866914)
        .then(features => features.map((c) => c.get('id')))
        .then(this.success('ADRNIVX_0000000357351682'));
    }

    getfnearest() {
        return this.geofile.nearestSearch(2.17427507927158, 48.8298733866914, 20)
        .then((feature) => [feature ? feature.get('id') : null])
        .then(this.success(['ADRNIVX_0000000287171004']));
    }

    getfattr() {
        return this.geofile.attributeSearch('id', ['ADRNIVX_0000000357351682'])
        .then(features => features.map((c) => c.get('adresse')))
        .then(this.success(['2 rue de versailles,92430 Marnes-la-Coquette']));
    }

    getffuzzy() {
        return this.geofile.fuzzySearch('nom_voie',  'rue des avellines')
        .then(features => features.map((c) => c.feature.get('nom_voie')))
        .then(this.success([
            'rue des avelines',
            'rue des avelines',
            'rue des avelines',
            'rue des avelines',
            'rue des avelines',
            'rue des avelines',
            'rue des avelines'
        ]));
    }

    getfprefix() {
        return this.geofile.prefixSearch('adresse', '23 rue de vers AVR')
        .then(features => features.map((c) => c.get('id')))
        .then(this.success([
            'ADRNIVX_0000000287181313',
            'ADRNIVX_0000000287181314',
            'ADRNIVX_0000000287181510',
            'ADRNIVX_0000000287181511',
            'ADRNIVX_0000000339893125',
            'ADRNIVX_0000000312916175',
            'ADRNIVX_0000000312909309',
            'ADRNIVX_0000000312917279',
            'ADRNIVX_0000000312918182',
            'ADRNIVX_0000000312909308',
            'ADRNIVX_0000000312909310',
            'ADRNIVX_0000000287181505',
            'ADRNIVX_0000000324719606',
            'ADRNIVX_0000000324719605',
            'ADRNIVX_0000000324719604',
            'ADRNIVX_0000000324719602',
            'ADRNIVX_0000000287181506',
            'ADRNIVX_0000000324719603',
            'ADRNIVX_0000000287181507',
            'ADRNIVX_0000000287181552']));
    }

}
