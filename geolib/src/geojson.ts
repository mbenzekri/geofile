'use strict';
import * as ol from './ol-debug';
import { _ } from './polyfill';
import { Geofile, GeofileFeature, GeofileOptions, GeofileFilterOptions } from './geofile';
import { FSFile, FSFormat } from './sync';
_();


/**
 * File System geojson class
 */
export class Geojson extends Geofile {

    private static FORMAT = new ol.format.GeoJSON();
    /** data file geojson */
    file: File;

    /**
     * promise that resolve to a new created and loaded geojson
     * @param filename complete full path and file name of the geojson to load
     * @param opts options to configure the created geojson object (see. GeofileOptions)
     * @returns the promise
     */
    static get(filename: string, opts: GeofileOptions = {}): Promise<Geofile> {
        const geojson = new Geojson(filename, opts);
        return geojson.load();
    }
    /** construct a Geojson object (dont use private use static geosjon() method) */
    private constructor(filename: string, opts: GeofileOptions = {}) {
        super(filename, opts);
    }

    /** internal method to get File object for Geojson file for random access */
    loadFeatures(): Promise<any> {
        return FSFile.get(this.filename)
            .then((file) => {
                this.file = file;
            });
    }

    getFeature_(rank: number, options: GeofileFilterOptions = {}): Promise<GeofileFeature> {
        const handle = this.getHandle(rank);
        return FSFile.slice(this.file, FSFormat.text, handle.pos, handle.len)
        .then(slice => {
                const objson = JSON.parse(slice);
                const feature = (Geojson.FORMAT.readFeature(objson) as GeofileFeature);
                return feature;
        });
    }
    getFeatures_(rank: number, count: number, options: GeofileFilterOptions): Promise<GeofileFeature[]> {
        const hmin = this.getHandle(rank);
        const hmax = this.getHandle(rank + count - 1);
        const length = (hmax.pos + hmax.len - hmin.pos);
        return FSFile.slice(this.file, FSFormat.arraybuffer, hmin.pos, length)
            .then((array: ArrayBuffer) => {
                const features = [];
                const td = new TextDecoder('utf8');
                for (let i = 0; i < count; i++) {
                    const handle = this.getHandle(rank + i);
                    const text = td.decode(array.slice(handle.pos - hmin.pos, handle.pos - hmin.pos + handle.len));
                    const objson = JSON.parse(text);
                    const feature = (Geojson.FORMAT.readFeature(objson) as GeofileFeature);
                    features.push(feature);
                }
                return features;
            });
    }
}
