import { Component, OnInit } from '@angular/core';
import * as gf from 'geofile';
import { TestBaseComponent } from './test-base.component';

@Component({
    selector: 'test-shapefile',
    templateUrl: './test-base.component.html',
    styleUrls: ['./test-base.component.css']
})

export class TestShapefileComponent extends TestBaseComponent implements OnInit {
    filename = '/GEO/FRANCE/countries_lakes.shp';
    attrname = 'NAME_SORT';
    shapefile: gf.Geofile;

    ngOnInit() {
        this.addTest({ method: TestShapefileComponent.prototype.load, should: 'load: should load shapefile file' });
        this.addTest({ method: TestShapefileComponent.prototype.foreach, should: 'forEach should get countries starting by "L"'});
        this.addTest({ method: TestShapefileComponent.prototype.getfeature, should: 'getFeature should get India'});
        this.addTest({ method: TestShapefileComponent.prototype.getfbbox, should: 'bboxSearch should get France neighborhood' });
        this.addTest({ method: TestShapefileComponent.prototype.getfpoint, should: 'pointSearch should get France  under point' });
        this.addTest({ method: TestShapefileComponent.prototype.getfnearest, should: 'nearestSearch should get France feature' });
        this.addTest({ method: TestShapefileComponent.prototype.getfattr, should: 'attributeSearch: should get feature by attribute' });
        this.addTest({ method: TestShapefileComponent.prototype.getffuzzy, should: 'attributeFuzzy: should get feature by fuzzy method' });
        this.addTest({ method: TestShapefileComponent.prototype.getfprefix, should: 'prefixSearch: should get feature by prefix' });
        super.ngOnInit();
    }
    load() {
        return gf.Sync.init(10 * Math.pow(1024, 3))
        .then(() => gf.Shapefile.get(this.filename))
        .then((shapefile) => {
            this.shapefile = shapefile;
            return [this.shapefile.count, this.shapefile.srs, this.shapefile.style !== null,
                this.shapefile.minscale, this.shapefile.maxscale, this.shapefile.name, this.shapefile.title, this.shapefile.group];
        })
        .then(this.success([255, 'EPSG:4326', true, 1000000, 10000000000, 'CountrySHP', 'World countries shapefile', 'root']));
    }

    foreach() {
        const result = [];
        const expected = ['Lebanon', 'Lithuania', 'Latvia', 'Luxembourg', 'Lao PDR', 'Libya', 'Liberia', 'Liechtenstein', 'Lesotho'];
        return this.shapefile.foreach({
            filter: (feature: ol.Feature) => {
                return feature.get(this.attrname) && feature.get(this.attrname).startsWith('L');
            },
            action: (feature: gf.GeofileFeature) => {
                result.push(feature.get(this.attrname));
            }
        }).then(() => result).then(this.success(expected));
    }

    getfeature() {
        return this.shapefile.getFeature(8)
            .then((feature) => [feature.get(this.attrname)])
            .then(this.success(['India']));
    }
    getfbbox() {
        const expected = ['France', 'Germany', 'Luxembourg', 'Belgium', 'Spain', 'United Kingdom',
                        'Italy', 'Switzerland', 'Netherlands', 'Monaco', 'Andorra', 'Jersey', 'Guernsey'];
        // france  extent
        return this.shapefile.bboxSearch([-4, 42, 9, 52])
        .then(features => features.map((c) => c.get(this.attrname)))
        .then(this.success(expected));
    }

    getfpoint() {
        // france center point
        return this.shapefile.pointSearch(6.5, 47.5)
        .then(features => features.map((c) => c.get(this.attrname)))
        .then(this.success(['France']));
    }

    getfnearest() {
        // centre de l'emprise france
        return this.shapefile.nearestSearch(6.5, 47.5, 100)
        .then((feature) => [feature ? feature.get(this.attrname) : null])
        .then(this.success(['France']));
    }

    getfattr() {
        return this.shapefile.attributeSearch(this.attrname, ['France', 'Germany'])
        .then(features => features.map((c) => c.get(this.attrname)))
        .then(this.success(['France', 'Germany']));
    }

    getffuzzy() {
        return this.shapefile.fuzzySearch(this.attrname,  'German')
        .then(features => features.map((c) => c.feature.get(this.attrname)))
        .then(this.success(['Germany']));
    }

    getfprefix() {
        return this.shapefile.prefixSearch(this.attrname, 'LI')
        .then(features => features.map((c) => c.get(this.attrname)))
        .then(this.success(['Lithuania', 'Libya', 'Liberia', 'Liechtenstein']));
    }

}
