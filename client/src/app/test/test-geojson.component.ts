import { Component, OnInit } from '@angular/core';
import * as gf from 'geofile';
import { TestBaseComponent } from './test-base.component';

const f: gf.GeofileFeature = null;

@Component({
    selector: 'test-geojson',
    templateUrl: './test-base.component.html',
    styleUrls: ['./test-base.component.css']
})
export class TestGeojsonComponent extends TestBaseComponent implements OnInit {
    filename = '/GEO/FRANCE/world.geojson';
    attrname = 'NAME_SORT';
    geojson: gf.Geofile;

    ngOnInit() {
        this.addTest({ method: TestGeojsonComponent.prototype.load, should: 'load: should load geojson file' });
        this.addTest({ method: TestGeojsonComponent.prototype.foreach, should: 'forEach should get countries starting by "L"'});
        this.addTest({ method: TestGeojsonComponent.prototype.getfeature, should: 'getFeature should get India'});
        this.addTest({ method: TestGeojsonComponent.prototype.getfbbox, should: 'bboxSearch should get France neighborhood' });
        this.addTest({ method: TestGeojsonComponent.prototype.getfpoint, should: 'pointSearch should get France  under point' });
        this.addTest({ method: TestGeojsonComponent.prototype.getfnearest, should: 'nearestSearch should get France feature' });
        this.addTest({ method: TestGeojsonComponent.prototype.getfattr, should: 'attributeSearch: should get feature by attribute' });
        this.addTest({ method: TestGeojsonComponent.prototype.getffuzzy, should: 'attributeFuzzy: should get feature by fuzzy method' });
        this.addTest({ method: TestGeojsonComponent.prototype.getfprefix, should: 'prefixSearch: should get feature by prefix' });
        super.ngOnInit();
    }
    load() {
        return gf.Sync.init(10 * Math.pow(1024, 3)).then(() => {
            return gf.Geojson.get(this.filename)
            .then((geojson) => {
                this.geojson = geojson;
                return [this.geojson.count, this.geojson.srs, this.geojson.style !== null,
                    this.geojson.minscale, this.geojson.maxscale, this.geojson.name, this.geojson.title, this.geojson.group];
            });
        }).then(this.success([ 255, 'EPSG:4326', true, 1000000, 10000000000, 'Country', 'World countries', 'root' ]));
    }

    foreach() {
        const result = [];
        const expected = ['Lebanon', 'Lithuania', 'Latvia', 'Luxembourg', 'Lao PDR', 'Libya', 'Liberia', 'Liechtenstein', 'Lesotho'];
        return this.geojson.foreach({
            filter: (feature: gf.GeofileFeature) => {
                return feature.get(this.attrname) && feature.get(this.attrname).startsWith('L');
            },
            action: (feature: gf.GeofileFeature) => {
                result.push(feature.get(this.attrname));
            }
        }).then(() => result).then(this.success(expected));
    }

    getfeature() {
        return this.geojson.getFeature(8)
            .then((feature) => [feature.get(this.attrname)])
            .then(this.success(['India']));
    }
    getfbbox() {
        const expected = ['France', 'Germany', 'Luxembourg', 'Belgium', 'Spain', 'United Kingdom',
                        'Italy', 'Switzerland', 'Netherlands', 'Monaco', 'Andorra', 'Jersey', 'Guernsey'];
        // france  extent
        return this.geojson.bboxSearch([-4, 42, 9, 52])
        .then(features => features.map((c) => c.get(this.attrname)))
        .then(this.success(expected));
    }

    getfpoint() {
        // france center point
        return this.geojson.pointSearch(6.5, 47.5)
        .then(features => features.map((c) => c.get(this.attrname)))
        .then(this.success(['France']));
    }

    getfnearest() {
        // centre de l'emprise france
        return this.geojson.nearestSearch(6.5, 47.5, 100)
        .then((feature) => [feature ? feature.get(this.attrname) : null])
        .then(this.success(['France']));
    }

    getfattr() {
        return this.geojson.attributeSearch(this.attrname, ['France', 'Germany', 'Algeria'])
        .then(features => features.map((c) => c.get('NAME_FR')))
        .then(this.success(['France', 'Allemagne', 'Algérie']));
    }

    getffuzzy() {
        return this.geojson.fuzzySearch(this.attrname,  'German')
        .then(features => features.map((c) => c.feature.get(this.attrname)))
        .then(this.success(['Germany']));
    }

    getfprefix() {
        return this.geojson.prefixSearch(this.attrname, 'LI')
        .then(features => features.map((c) => c.get(this.attrname)))
        .then(this.success(['Lithuania', 'Libya', 'Liberia', 'Liechtenstein']));
    }

}
