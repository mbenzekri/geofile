import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import * as ol from '../../../../geolib/src/ol-debug';
import * as gf from 'geofile';

@Component({
    selector: 'sk-map-test',
    templateUrl: './sk-map-test.component.html',
    styleUrls: ['./sk-map-test.component.css']
})

export class SkMapTestComponent implements OnInit {
    ref: ChangeDetectorRef;
    message = '';
    all: gf.Geofile[] = [];
    osm: ol.layer.Tile;
    layers: ol.layer.Layer[] = [];
    map: ol.Map;
    style = new ol.style.Style({
        stroke: new ol.style.Stroke({
            color: '#00C58A',
            width: 2
        })
    });

    constructor(private aref: ChangeDetectorRef) {
        this.ref = aref;
    }

    ngOnInit() {
        gf.Sync.init(10 * Math.pow(1024, 3))
            .then( () =>  gf.Geojson.get('/GEO/world/world.geojson'))
            .then((geofile) => this.all.push(geofile) )
            .catch( e => this.message = `world.geojson ${e.message}` )
            .then( () => gf.Shapefile.get('/GEO/world/countries_lakes.shp'))
            .then( geofile => this.all.push(geofile) )
            .catch( e => this.message = `countries_lakes.shp ${e.message}` )
            .then( () => gf.Shapefile.get('/GEO/FRANCE/communes.shp', {style: this.style, maxscale: 1000000}))
            .then( geofile => this.all.push(geofile) )
            .catch( e => this.message = `communes.shp ${e.message}` )
            // .then( () => Geojson.get('/GEO/FRANCE/cadastre-92-parcelles.json'))
            // .then( geofile => this.all.push(geofile) )
            // .catch( e => this.message = `cadastre-92-parcelles.json ${e.message}` )
            // .then( () => Geojson.get('/GEO/FRANCE/cadastre-92-batiments.json'))
            // .then( geofile => this.all.push(geofile) )
            // .catch( e => this.message = `cadastre-92-batiments.json ${e.message}` )
            // .then( () => Csv.get('/GEO/FRANCE/adresses_92.csv'))
            // .then( geofile => this.all.push(geofile) )
            // .catch( e => this.message = `adresses_92.csv ${e.message}` )
            // .then( () => Csv.get('/GEO/FRANCE/parcelles_75.shp'))
            // .then( geofile => this.all.push(geofile) )
            // .catch( e => this.message = `parcelles_75.shp ${e.message}` )
            .then(() =>  this.initMap());
    }

    initMap() {
        ol.interaction.defaults({ altShiftDragRotate: false, pinchRotate: false });
        const panInter = new ol.interaction.DragPan();
        panInter.setActive(true);
        const interations = [
            new ol.interaction.DoubleClickZoom(),
            new ol.interaction.PinchZoom(),
            new ol.interaction.KeyboardPan(),
            new ol.interaction.KeyboardZoom(),
            new ol.interaction.MouseWheelZoom(),
            new ol.interaction.DragZoom(),
            panInter
        ];
        this.osm = new ol.layer.Tile({ source: new ol.source.OSM() });

        this.map = new ol.Map({
            layers: [this.osm],
            overlays: [],
            controls: ol.control.defaults({ attribution: false, zoom: false }).extend([
                new ol.control.ScaleLine()
            ]),
            interactions: interations,
            renderer: 'canvas',
            target: 'map',
            view: new ol.View({
                center: ol.proj.transform([2.5, 47.5], 'EPSG:4326', 'EPSG:3857'),
                zoom: 5,
                zoomFactor: 1.5
            })
        });
        this.map.getView().on('change:resolution', (e) => this.ref.detectChanges());
        this.all.forEach(geofile => this.layers.push(geofile.addAsVector(this.map)));
    }
    get scale () {
        if (!this.map) { return 1; }
        const proj = this.map.getView().getProjection();
        const resol = this.map.getView().getResolution();
        const scale = this.all[0].getScale(resol, proj);
        return Math.round(scale);
    }
    switch(ilayer) {
        const layer = this.layers[ilayer];
        layer.setVisible(!layer.getVisible());
    }
    switchOSM() {
        this.osm.setVisible(!this.osm.getVisible());
    }
}
