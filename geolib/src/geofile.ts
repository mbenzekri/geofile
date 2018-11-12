'use strict';
import { binrbush } from './binrbush';
import * as proj4 from 'proj4';
import { _ } from './polyfill';
import { BinRtree } from './binrtree';
import * as fs from './sync';
_();

const WGS84 = 'EPSG:4326';
const HANDLE_SIZE = 10;
const INDEX_MD_SIZE = 68;

const transformExtent = function (extent: number[], src: string, dest: string): number[] {
    const t = proj4(src, dest);
    const linestr = [
        t.forward([extent[0], extent[1]]),
        t.forward([extent[2], extent[1]]),
        t.forward([extent[2], extent[3]]),
        t.forward([extent[0], extent[3]]),
    ];
    const xmin = Math.min(linestr[0][0], linestr[1][0], linestr[2][0], linestr[3][0]);
    const xmax = Math.max(linestr[0][0], linestr[1][0], linestr[2][0], linestr[3][0]);
    const ymin = Math.min(linestr[0][1], linestr[1][1], linestr[2][1], linestr[3][1]);
    const ymax = Math.max(linestr[0][1], linestr[1][1], linestr[2][1], linestr[3][1]);
    return [xmin, ymin, xmax, ymax];
}

const haversineDistance = function (c1: number[], c2: number[]) {
    const radius = 6378137;
    const lat1 = c1[1] * Math.PI / 180;
    const lat2 = c2[1] * Math.PI / 180;
    const deltaLatBy2 = (lat2 - lat1) / 2;
    const deltaLonBy2 = ((c2[0] - c1[0]) * Math.PI / 180) / 2;
    const a = Math.sin(deltaLatBy2) * Math.sin(deltaLatBy2) +
        Math.sin(deltaLonBy2) * Math.sin(deltaLonBy2) *
        Math.cos(lat1) * Math.cos(lat2);
    return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};


export enum GeofileFiletype {
    CSV,
    GEOJSON,
    SHP,
    DBF,
    PRJ,
    GML2,
    GML3,
    KML
}
export enum GeofileGeomtype {
    Point = 'Point',
    MultiPoint = 'MultiPoint',
    LineString = "LineString",
    MultiLineString = "MultiLineString",
    Polygon = "Polygon",
    MultiPolygon = "MultiPolygon",
    GeometryCollection = "GeometryCollection"
}

export declare type GeofileGeometry = {
    type: GeofileGeomtype, 
    coordinates: number[] | number[][] | number[][][], 
}

export class GeofileFeature {
    geometry?: GeofileGeometry;
    properties?: any = {};
    rank?: number;
    proj?: string;
    geofile?: Geofile;
    distance?: number;

    constructor(geometry: GeofileGeometry, properties = {}) {
        this.geometry = geometry;
        this.properties = properties ;
    }
    transform(dest: string) {
        const transform = proj4(this.proj, dest);
        let transloop = (arr: any[]): any[] => {
            return !arr ? null
                : (arr.length >= 2 && !Array.isArray(arr[0]))
                    ? transform.forward(arr)
                    : arr.map(subarr => transloop(subarr))
        }
        return (typeof this.geometry === 'string') ? null : transloop(this.geometry.coordinates)
    }
    intersectsExtent(extent: number[]): boolean {
        return true;
    }
    intersectsCoordinate(coords: number[]): boolean {
        return true;
    }
    get(attribute: string) {
        return this.properties ? this.properties[attribute] : null;
    }
    getClosestPoint(point: number[]): number[] {
        return [];
    }
}

export interface GeofileOptions {
    /** unique symbolic name to identify the dataset */
    name?: string;
    /** human readable name for the dataset (for list)*/
    title?: string;
    /** longer description */
    desc?: string;
    /** name to group datasets together */
    group?: string;
    /** property name for id usage for the dataset */
    idprop?: string;
    /** Spatial Reference System for the geometry coodinates (ex: EPSG:4326) */
    srs?: string;
    /** minimum scale denominator for visible scale */
    minscale?: number;
    /** maximum scale denominator for visible scale */
    maxscale?: number;
    /** style function  */
    style?: Function;
    /** schema to describe data structure */
    schema?: any;
}

interface GeofileHandle {
    rank: number;
    pos: number;
    len: number;
    tmin: number;
    tmax: number;
}
/**
 * filter / action option struct
 */
export interface GeofileFilterOptions {
    /** target projection all feature will be transform into this projection if necessary */
    proj?: 'WGS84';
    /** do not use (used for internal index filtering ) */
    _filter?: ((feature: GeofileFeature) => boolean)[];
    /** filter function only features that match this test function are returned*/
    filter?: (feature: GeofileFeature) => boolean;
    /** action function applied to all returned features (caution! above projection applied)*/
    action?: (feature: GeofileFeature) => void;
    /** cache for optimisation */
    cache?: Map<number, GeofileFeature>;
    /** tolerance for pointSearch */
    tolerance?: number;
    /** max levenshtein distance for fuzzy search */
    maxlevenshtein?: number;
}

enum GeofileIndexType {
    handle = 'handle',
    rtree = 'rtree',
    ordered = 'ordered',
    fuzzy = 'fuzzy',
    prefix = 'prefix'
}

/** Index structure handled by Geofile class */
interface GeofileIndex {
    /** attribute name indexed */
    attribute: string;
    /** index type name  */
    type: GeofileIndexType;
    /** dataview on the index data  when loaded */
    dv: DataView;
}


/**
 * File System spatial data class
 */
export abstract class Geofile {

    /** if true time statistics are logged */
    private static TIMEON = true;
    /** default style of Geofile class when not given */
    static readonly style = null;
    /* geofile objects set */
    private static readonly ALL = new Map<string, Geofile>();

    /** geofile dataset file name  */
    readonly filename: string;
    /** minimum scale for dataset display */
    readonly minscale: number;
    /** maximum scale for dataset display */
    readonly maxscale: number;
    /** geofile dataset symbolic name */
    readonly name: string;
    /** geofile dataset symbolic human readable name */
    readonly title: string;
    /** grouping name for a set of geofile dataset */
    readonly group: string;
    /** openlayers style function to display features for this datatset */
    readonly style: Function;
    /** geofile dataset projection calculated through this.srs */
    readonly proj = 'WGS84';
    /** feature count for this datatset */
    readonly count: number;
    /** true if dataset is loaded (call load() method) */
    readonly loaded: boolean;
    /** index Map */
    private indexes = new Map<string, GeofileIndex>();
    /** handles data view */
    private handles: DataView;
    /** rbush rtree */
    private rtree: BinRtree;
    /** style file name associated to the geofile file */
    get confname() { return this.filename.replace(/\.[^/.]+$/, '') + '.js'; }
    /** index file name associated to the geofile file */
    get idxname() { return this.filename.replace(/\.[^/.]+$/, '') + '.idx'; }
    /** extent of the geofile dataset */
    get extent(): number[] { return this.rtree.extent(); }

    /** array off all geofile */
    static get all() { return Geofile.ALL.values(); }
    /** method to find a geofile by it's name */
    static search(name: string) { return Geofile.ALL.get(name); }
    /** remove a geofile by it's name */
    static delete(name: string) { Geofile.ALL.delete(name); }
    /** remove all geofile */
    static clear() { Geofile.ALL.clear(); }

    abstract getFeature_(rank: number, options: GeofileFilterOptions): Promise<GeofileFeature>;
    abstract getFeatures_(rank: number, count: number, options: GeofileFilterOptions): Promise<GeofileFeature[]>;
    abstract loadFeatures(): Promise<any>;

    getFeature(rank: number, options: GeofileFilterOptions = {}): Promise<GeofileFeature> {
        this.assertLoaded();
        if (rank < 0 || rank >= this.count) { return Promise.resolve(null); }
        return this.getFeature_(rank, options)
            .then(feature => {
                if (feature) {
                    // feature.setId(this.name + '_' + rank);
                    feature.proj = this.proj;
                    feature.rank = rank;
                    feature.geofile = this;
                    feature = this.apply(feature, options);
                }
                return feature;
            });
    }

    getFeatures(rank: number, count = 100, options: GeofileFilterOptions = {}): Promise<GeofileFeature[]> {
        this.assertLoaded();
        if (rank < 0 || rank >= this.count) { return Promise.resolve([]); }
        if (count <= 0) { return Promise.resolve([]); }
        count = Math.min(count, this.count - rank);
        return this.getFeatures_(rank, count, options)
            .then(features => {
                const result = [];
                features.forEach(feature => {
                    // feature.setId(this.name + '_' + rank);
                    feature.proj = this.proj;
                    feature.rank = rank;
                    feature.geofile = this;
                    feature = this.apply(feature, options);
                    if (feature) { result.push(feature); }
                    rank++;
                });
                return result;
            });
    }

    protected getHandle(rank: number): GeofileHandle {
        const pos = this.handles.getUint32(rank * HANDLE_SIZE);
        const len = this.handles.getUint32(rank * HANDLE_SIZE + 4);
        const tmin = this.handles.getUint8(rank * HANDLE_SIZE + 8);
        const tmax = this.handles.getUint8(rank * HANDLE_SIZE + 9);
        return { rank, pos, len, tmin, tmax };
    }

    /** construct a Geofile object (dont use private use static geosjon() method) */
    constructor(filename: string, opts: GeofileOptions = {}) {
        this.filename = filename;
        this.init(opts);
        this.handles = null;
        this.rtree = null;
        this.loaded = false;
        Geofile.ALL.set(this.name, this);
    }

    /** internal method to init/construct a Geofile object */
    private init(opts: GeofileOptions = {}) {
        this['' + 'minscale'] = opts.minscale || 0;
        this['' + 'maxscale'] = opts.maxscale || 10000;
        this['' + 'name'] = opts.name || this.filename.split('\\').pop().split('/').pop();
        this['' + 'title'] = opts.title || this.name;
        this['' + 'group'] = opts.group || 'root';
        this['' + 'style'] = opts.style || Geofile.style;
        this['' + 'proj'] = opts.srs;
    }

    /**
     * assertion: check for loaded geosjon
     */
    assertLoaded() {
        if (!this.loaded) {
            throw (new Error(`geofile [${this.filename}] attemting to access data before loading`));
        }
    }
    /**
     * assertion: check for loaded geosjon
     */
    assertindex(attribute: string, type: GeofileIndexType): GeofileIndex | Error {
        const index = this.indexes.get(attribute + '/' + type);
        return index ? index : new Error(`geofile [${this.name}] unable to ${type} search attribute ${attribute}  no index found`);
    }

    /** internal method to load configuration file for Geofile object */
    private loadConf(): Promise<any> {
        // try load configuration file
        return fs.FSFile.read(this.confname, fs.FSFormat.text)
            .then((data) => {
                try {
                    // tslint:disable-next-line:no-eval
                    const conf = eval(data);
                    this.init(conf);
                    return Promise.resolve();
                } catch (e) {
                    return Promise.reject(new Error(`geofile conf file ${this.confname} eval error: ${e.toString()} !`));
                }
            })
            .catch((e) => {
                console.log(`geofile conf file ${this.confname} not found`);
                return Promise.resolve();
            });
    }

    /** internal method to load all data indexes */
    private loadIndexes(): Promise<any> {
        return fs.FSFile.read(this.idxname, fs.FSFormat.arraybuffer)
            .then((idxbuffer: ArrayBuffer) => {
                // read feature count and index count
                let dv = new DataView(idxbuffer, 0, 16);
                this['' + 'count'] = dv.getUint32(8);
                const nbindex = dv.getUint32(12);
                this.indexes = new Map<string, GeofileIndex>();

                // load index metadata and data
                const td = new TextDecoder();
                dv = new DataView(idxbuffer.slice(16, 16 + nbindex * INDEX_MD_SIZE));
                let pos = 0;
                for (let i = 0; i < nbindex; i++) {
                    let attribute: string, type: string, buffer: number, length: number;
                    attribute = td.decode(dv.buffer.slice(pos, pos + 50)).replace(/\000/g, '');
                    pos += 50;
                    type = td.decode(dv.buffer.slice(pos, pos + 10)).replace(/\000/g, '');
                    pos += 10;
                    buffer = dv.getUint32(pos);
                    pos += 4;
                    length = dv.getUint32(pos);
                    pos += 4;
                    const idxdv = new DataView(idxbuffer, buffer, length);
                    this.indexes.set(attribute + '/' + GeofileIndexType[type], { attribute, type: GeofileIndexType[type], dv: idxdv });
                    if (type === GeofileIndexType.handle) { this.handles = idxdv; }
                    if (type === GeofileIndexType.rtree) { this.rtree = new BinRtree(idxdv); }
                }
            });
    }

    /** internal method to set load status when loading is terminated */
    private loadTerminate(): Promise<Geofile> {
        this['' + 'loaded'] = (this.count > 0 && this.handles && this.indexes && this.rtree) ? true : false;
        return this.loaded ? Promise.resolve(this) : Promise.reject(new Error('Unable to load Geofile data files'));
    }

    /**
     * calculate for a given rank (feature) in a cluster its cluster bbox (minitile)
     * @param rank the rank of the feature
     * @param cluster the cluster where the rank was found
     * @returns the calculated bbox
     */
    private clusterBbox(rank: number, cluster: number[]): number[] {
        const handle = this.getHandle(rank);
        const wtile = Math.abs(cluster[2] - cluster[0]) / 16;
        const htile = Math.abs(cluster[3] - cluster[1]) / 16;
        // tslint:disable-next-line:no-bitwise
        const ymin = (0xF & handle.tmin);
        // tslint:disable-next-line:no-bitwise
        const xmin = (handle.tmin >> 4);
        // tslint:disable-next-line:no-bitwise
        const ymax = (0xF & handle.tmax) + 1;
        // tslint:disable-next-line:no-bitwise
        const xmax = (handle.tmax >> 4) + 1;
        return [
            cluster[0] + (xmin * wtile),
            cluster[1] + (ymin * htile),
            cluster[0] + (xmax * wtile),
            cluster[1] + (ymax * htile)
        ];
    }

    protected apply(feature: GeofileFeature, options: GeofileFilterOptions): GeofileFeature {
        if (options._filter && options._filter.some(function (func) { return !func(feature); })) { return undefined; }
        if (options.proj && options.proj !== (feature as any).proj) {
            feature.transform(options.proj);
        }
        if (options.filter && !options.filter(feature)) { return undefined; }
        if (options.action) { options.action(feature); }
        return feature;
    }

    private setFilter(opts: GeofileFilterOptions, filter: (feature: GeofileFeature) => boolean) {
        const options: GeofileFilterOptions = opts.applyTo({ _filter: [] });
        options._filter.push(filter);
        return options;
    }

    /** return true if bbox1 intersects bbox2, false otherwise */
    private intersects(bbox1: number[], bbox2: number[]): boolean {
        return bbox2[0] <= bbox1[2] && bbox2[1] <= bbox1[3] &&
            bbox2[2] >= bbox1[0] && bbox2[3] >= bbox1[1];

    }

    newCache() {
        return new Map<number, GeofileFeature>();
    }

    load(): Promise<Geofile> {
        let current = null;
        return this.loadConf().catch(e => { throw current ? e : new Error(current = e.message + '(during loadConf)'); })
            .then(() => this.loadIndexes()).catch(e => { throw current ? e : new Error(current = e.message + '(during loadIndexes)'); })
            .then(() => this.loadFeatures()).catch(e => { throw current ? e : new Error(current = e.message + '(during loadFeatures)'); })
            .then(() => this.loadTerminate()).catch(e => { throw current ? e : new Error(current = e.message + '(during loadTerminate)'); });
    }

    foreach(options: GeofileFilterOptions = {}): Promise<null> {
        const start = Date.now();
        return new Promise((resolve) => {
            const loop = (i = 0) => {
                this.assertLoaded();
                if (i < this.count) {
                    return this.getFeatures(i, 1000, options).then(() => loop(i + 1000));
                }
                const elapsed = (Date.now() - start) / 1000;
                console.log(`Geofile.foreach [${this.name}]: ${this.count} o / ${Math.round(elapsed)} s / ${Math.round(this.count / elapsed)} o/s`);
                resolve(null);
            };
            loop();
        });
    }

    bboxSearch(bbox: number[], options: GeofileFilterOptions = {}): Promise<GeofileFeature[]> {
        this.assertLoaded();
        const projbbox = options.proj ? transformExtent(bbox, this.proj, options.proj) : null;
        const start = Date.now();

        options = this.setFilter(options, (feature: GeofileFeature) => {
            const abbox = (feature.proj === options.proj) ? projbbox : bbox;
            const res = feature.intersectsExtent(abbox);
            return res;
        });

        // parcours de l'index geographique.
        const bboxlist = this.rtree.search(bbox).filter(ibbox => this.intersects(ibbox, bbox));
        const promises = bboxlist.map(ibbox => {
            return this.getFeatures(ibbox[4], ibbox[5], options);
        });
        const selectivity = Math.round(100 * bboxlist.reduce((p, c) => p + c[5], 0) / this.count);

        return Promise.cleanPromiseAll(promises)
            .then((features) => {
                const elapsed = (Date.now() - start);
                const best = Math.round(100 * features.length / this.count);
                const objsec = Math.round(features.length / (elapsed / 1000));
                console.log(`Geofile.bboxSearch [${this.name}]: ${features.length} o / ${elapsed} ms /  ${objsec} obj/s sel: ${selectivity}% (vs ${best}%)`);
                return features;
            });
    }

    pointSearch(lon: number, lat: number, options: GeofileFilterOptions = {}): Promise<GeofileFeature[]> {
        this.assertLoaded();
        const tol = options.tolerance ? options.tolerance : 0.00001;
        options = this.setFilter(options, (feature: GeofileFeature) => {
            const point = proj4(this.proj, feature.proj).forward([lon, lat]);
            return feature.intersectsCoordinate(point);
        });
        return this.bboxSearch([lon - tol, lat - tol, lon + tol, lat + tol], options);
    }

    /**
     * search and return the nearest feature arround a point
     * @param gjspt a generic point
     * @param rorb raduis or bbox
     * @param options filter options
     */
    nearestSearch(lon: number, lat: number, rorb: number | number[], options: GeofileFilterOptions = {}): Promise<GeofileFeature> {
        this.assertLoaded();
        const wgs84pt = proj4(this.proj, WGS84).forward([lon, lat]);
        let bbox;
        if (Array.isArray(rorb)) {
            bbox = rorb;
        } else {
            const unitpermeter = 1 / proj4.defs(this.proj).to_meter;
            const wgs84r = rorb * unitpermeter;
            bbox = [wgs84pt[0] - wgs84r, wgs84pt[1] - wgs84r, wgs84pt[0] + wgs84r, wgs84pt[1] + wgs84r];
            options = this.setFilter(options, (feature: GeofileFeature) => {
                const closest = feature.getClosestPoint([lon, lat]);
                const closest_wgs84 = proj4(feature.proj, WGS84).forward(closest);
                feature.distance = haversineDistance(wgs84pt, closest_wgs84);
                return (feature.distance <= wgs84r);
            });
        }
        return this.bboxSearch(bbox, options)
            .then((features) => features.reduce((previous: GeofileFeature, current: GeofileFeature) => {
                return !current ? previous : !previous ? current : (previous.distance < current.distance) ? previous : current;
            }));
    }
    /**
     * starting with idwrank in the index and by incremental steps search for all the features
     * that match the compare function (stop when first matching fail occurs)
     * @param index search index
     * @param idxrank rank in the index
     * @param searched searched strings
     * @param compare comparison function
     * @param options filter options
     * @param found internal use for recursive calls
     */
    private next(index: GeofileIndex, idxrank: number, searched: any[], compare: Function,
        options: GeofileFilterOptions, found: GeofileFeature[] = []): Promise<GeofileFeature[]> {
        if (idxrank < this.count) {
            const rank = index.dv.getUint32(idxrank * 4);
            return this.getFeature(rank)
                .then(feature => {
                    const res = searched.some((search) => compare(search, feature) === 0);
                    if (res) {
                        feature = this.apply(feature, options);
                        if (feature) { found.push(feature); }
                        return this.next(index, idxrank + 1, searched, compare, options, found);
                    }
                    return found;
                });
        }
        return Promise.resolve(found);
    }

    private binarySearch(idxdata: GeofileIndex, searched: any[], compare: (a, b) => number,
        options: GeofileFilterOptions, imin: number = 0, imax: number = (this.count - 1)): Promise<GeofileFeature[]> {

        // is dichotomy terminated
        if (imax >= imin) {
            // calculate midpoint to cut set in half
            const imid = Math.floor((imax + imin) / 2);
            const rank = idxdata.dv.getUint32(imid * 4);
            return this.getFeature(rank).then(feature => {
                const promises = [];
                if (imin === imax) {
                    // end search reached
                    promises.push(this.next(idxdata, imin, searched, compare, options));
                } else {
                    // constructing lower and upper subset (lsubset / usubset)
                    const lsubset = [], usubset = [];
                    // distribution on subsets
                    searched.forEach((key, i) => (compare(key, feature) > 0) ? lsubset.push(searched[i]) : usubset.push(searched[i]));
                    // preparing search promises for lower and upper subset
                    if (lsubset.length) { promises.push(this.binarySearch(idxdata, lsubset, compare, options, imid + 1, imax)); }
                    if (usubset.length) { promises.push(this.binarySearch(idxdata, usubset, compare, options, imin, imid)); }
                }
                // running promises
                return Promise.cleanPromiseAll(promises)
                    .then(features => {
                        return features;
                    });
            });
        }
        return Promise.resolve([]);
    }

    attributeSearch(attr: string, values: any[], options: GeofileFilterOptions = {}): Promise<GeofileFeature[]> {
        const index = this.assertindex(attr, GeofileIndexType.ordered);
        if (index instanceof Error) { return Promise.reject(index); }
        const filter = (feature) => {
            return feature && values.some(function (v) { return v === feature.get(attr); });
        };
        const compare = (key, feature) => {
            return (feature && key === feature.get(attr)) ? 0 : (key > feature.get(attr)) ? 1 : -1;
        };
        options = this.setFilter(options, filter);
        return this.binarySearch(index, values, compare, options);
    }

    fuzzySearch(attr: string, value: string, options: GeofileFilterOptions = {}): Promise<{ distance: number, feature: GeofileFeature }[]> {
        const index = this.assertindex(attr, GeofileIndexType.fuzzy);
        if (index instanceof Error) { return Promise.reject(index); }
        const maxlevens = options.maxlevenshtein ? options.maxlevenshtein : 5;
        const compare = (k, f) => k - f.get(attr).fuzzyhash();
        const clean = value.clean();
        const hash = value.fuzzyhash();
        const values = String.fuzzyExtend(hash);
        values.push(hash);
        options = this.setFilter(options, f => clean.levenshtein(f.get(attr).clean()) < maxlevens);
        return this.binarySearch(index, values, compare, options)
            .then((features) => {
                let sorted = [];
                if (features && features.length > 0) {
                    const res = features.map((feature) => ({ distance: clean.levenshtein(feature.get(attr).clean()), feature: feature }));
                    const positions = features.map(function (feature, pos) { return pos; });
                    sorted = res.sort((p1, p2) => p1.distance - p2.distance);
                }
                return sorted;
            });
    }

    /** Search with a dichotomic algorithm all ranks associated with an array of prefix
     * a rank found must have all prefixes associated
     * index data is an ordered array of tuple [ prefix:char[4], rank:uint32 ] (each tuple have 8 bytes)
    */
    private binaryPrefixSearch(index: GeofileIndex,
        arrpref: string[],
        found: Map<number, string> = null,
        imin: number = 0,
        imax: number = index.dv.byteLength / 8
    ): Map<number, string> {
        // ----------------------------------------------------------------------------------------
        // dv dataview points to an ordered array of tuple [ prefix:char[4], rank:uint32 ]
        // this utility function return a tuple for a given tuple index
        // ----------------------------------------------------------------------------------------
        const getentry = (dv: DataView, tuple: number) => {
            const prefix = String.fromCharCode(...([0, 1, 2, 3].map((c) => dv.getUint8(tuple * 8 + c))));
            const rank = dv.getUint32(tuple * 8 + 4);
            return { prefix, rank };
        };
        // ----------------------------------------------------------------------------------------
        // prefix found from imin searching intersection with previously foundranks
        // ----------------------------------------------------------------------------------------
        const intersect = (dv: DataView, previous?: Map<number, string>): Map<number, string> => {
            arrpref.map(prefix => {
                const intersection = new Map<number, string>();
                const len = Math.min(4, prefix.length);
                const size = dv.byteLength;
                let samepref = true;
                for (let tuple = imin; samepref && (tuple < dv.byteLength / 8); tuple++) {
                    const e = getentry(dv, tuple);
                    samepref = e.prefix.startsWith(prefix);
                    if (samepref && (!previous || previous.has(e.rank))) { intersection.set(e.rank, prefix); }
                }
                previous = intersection;
            });
            return previous;
        };
        // ----------------------------------------------------------------------------------------
        // test if array is empty
        if (imax < imin) { return new Map<number, string>(); }

        // calculate midpoint to cut set in half
        const imid = Math.floor((imax + imin) / 2);
        if (imin === imax) { return intersect(index.dv, found); }

        const entry = getentry(index.dv, imid);
        const usubset = [];
        const lsubset = [];
        arrpref.forEach(p => (p.substring(0, 4) > entry.prefix) ? usubset.push(p) : lsubset.push(p));
        if (usubset.length) { found = this.binaryPrefixSearch(index, usubset, found, imid + 1, imax); }
        if (lsubset.length) { found = this.binaryPrefixSearch(index, lsubset, found, imin, imid); }
        return found;
    }

    prefixSearch(attr: string, prefix: string, maxfeature: number = 100): Promise<GeofileFeature[]> {
        const index = this.assertindex(attr, GeofileIndexType.prefix);
        if (index instanceof Error) { return Promise.reject(index); }
        const arrpref = prefix.prefix();
        // on recherche la première entrée dans l'index pour chaque préfixe
        const found = this.binaryPrefixSearch(index, arrpref);
        // si un des préfixes n'a pas été trouvé aucun résultat
        if (found.size === 0) { return Promise.resolve([]); }
        // transformer les clés (rank) de la Map found en Array
        const features = [];
        const ranks = Array.from(found.keys());
        let i = 0;
        const filter = (resolve, reject) => {
            if (i >= ranks.length || features.length >= maxfeature) {
                return resolve(features);
            }
            this.getFeature(ranks[i], {}).then((feature) => {
                // MBZ TODO j'ai supprimer ce test il ne marche pas et est redondant
                // if (arrpref.every(p => feature.get(attr).includes(p))) {
                features.push(feature);
                // }
                i += 1;
                filter(resolve, reject);
            });
        };
        return new Promise(filter);
    }
    /**
     * get scale from resolution
     * @param resolution a resolution
     * @param projection the target map projectiion
     * @returns corresponding resolution for scale
     */
    getScale(resolution: number, projection: string): number {
        // const units = projection.getUnits();
        const dpi = 25.4 / 0.28;
        const mpu = proj4.defs(projection).to_meter; // MBZ TODO A REVOIR CALCUL D'ECHELLE
        const scale = resolution * mpu * 39.37 * dpi;
        return scale;
    }

    /**
     * get resolution from scale
     * @param scale a scale
     * @param projection the target map projectiion
     * @returns corresponding resolution for scale
     */
    getResolution(scale: number, projection: string): number {
        // const units = projection.getUnits();
        const dpi = 25.4 / 0.28;
        const mpu = proj4.defs(projection).to_meter;
        const resolution = scale / (mpu * 39.37 * dpi);
        return resolution;
    }

    addIndexTiles(map: any, ol: any) {
        const tiles = [];
        const srcproj = this.proj;
        this.rtree._all(0, tiles);
        const features = tiles.map(function (tile) {
            const geometry = new ol.geom.Polygon([[
                [tile[0], tile[1]],
                [tile[2], tile[1]],
                [tile[2], tile[3]],
                [tile[0], tile[3]],
                [tile[0], tile[1]]
            ]]);
            geometry.transform(srcproj, map.getView().getProjection());
            const feature = new ol.Feature({ num: tile[4] / 100, geometry });
            return feature;
        });
        const vectorSource = new ol.source.Vector({});
        const vlayer = new ol.layer.Vector({
            source: vectorSource,
            style: [new ol.style.Style({
                stroke: new ol.style.Stroke({
                    color: 'red',
                    width: 2
                })
            })]
        });
        vectorSource.addFeatures(features);
        map.addLayer(vlayer);
        const tilelayer = new ol.layer.Tile({
            source: new ol.source.TileDebug({
                projection: 'EPSG:3857',
                tileGrid: ol.tilegrid.createXYZ({ maxZoom: 22 })
            })
        });
        map.addLayer(tilelayer);
    }

    /**
     * add this geofile to an openlayer Map as an ol.layer.Vector
     * @param map an openlayers 3+ Map
     * @param ol an openlayers 3+ global object
     */
    addAsVector(map: any, ol: any) {
        let last_extent = ol.extent.createEmpty();
        const cache = this.newCache();
        let vsource: ol.source.Vector;
        let format = new ol.format.GeoJSON();
        /** default style definition */
        const fill = new ol.style.Fill({
            color: 'rgba(255,255,255,0.4)'
        });
        const stroke = new ol.style.Stroke({
            color: '#3399CC',
            width: 1.25
        });
        const DEFAULT_STYLE = [
            new ol.style.Style({
                image: new ol.style.Circle({
                    fill: fill,
                    stroke: stroke,
                    radius: 5
                }),
                fill: fill,
                stroke: stroke
            })
        ];


        // we define a loader for vector source
        const loader = (extent, resolution, proj) => {
            if (ol.extent.equals(extent, last_extent)) { return; }
            last_extent = extent;
            const scale = this.getScale(resolution, proj);
            extent = (proj === this.proj) ? extent : ol.proj.transformExtent(extent, proj, this.proj);
            if ((!this.maxscale || scale < this.maxscale) && (!this.minscale || scale >= this.minscale)) {
                this.bboxSearch(extent, { proj, cache })
                    .then((features) => {
                        vsource.clear();
                        vsource.addFeatures(features.map(f => format.readFeature(f)));
                    });
            } else {
                vsource.clear();
            }
        };
        vsource = new ol.source.Vector({ useSpatialIndex: false, strategy: ol.loadingstrategy.bbox, loader });
        // layer created an added to map
        const vlayer = new ol.layer.Vector({
            renderMode: 'image',
            visible: true,
            source: vsource,
            style: this.style ? this.style : DEFAULT_STYLE,
            minResolution: this.getResolution(this.minscale, map.getView().getProjection()),
            maxResolution: this.getResolution(this.maxscale, map.getView().getProjection())
        });
        map.addLayer(vlayer);
        return vlayer;
    }
}


export interface GeofileParser {
    // file type
    type: GeofileFiletype;
    // collection to collect data during parsing
    collection: GeofileIndexFeature[];
    // filename to parse
    filename: string;
    // file is mandatory ?
    mandatory: boolean
    // last modification datetime
    mdate: Date;
    // onData method to receive async read data from file
    onData(buffer: ArrayBuffer);
}


export class GeofileBinaryParser implements GeofileParser {
    // implements GeofileParser
    readonly type: GeofileFiletype;
    readonly collection: GeofileIndexFeature[] = [];
    readonly filename: string;
    mandatory: boolean = true;
    mdate: Date = null;

    protected offset: number = 0;               // offset in the file of the first byte in buffer
    protected read: number = 0;                 // bytes read (but not treated between offset and read )
    private length: number = 0;                 // waiting for length bytes before calling callback
    private callback: (dv: DataView) => void;   // callback to transform received data
    private buffer: number[] = [];              // buffered data

    constructor(filename: string, type: GeofileFiletype, mandatory: boolean) {
        this.filename = filename;
        this.type = type;
        this.mandatory = mandatory;
    }

    /**
     * data to be provided to the parser.
     * @param arrbuf data array buffer to be pushed to the parser
     */
    onData(arrbuf: ArrayBuffer) {
        for (let i = 0, dv = new DataView(arrbuf); i < dv.byteLength; i++) {
            this.buffer.push(dv.getUint8(i))
        };
        while (this.length <= this.buffer.length) {
            // waited length data reached calling callback
            var arraybuf = new ArrayBuffer(this.length);
            var dv = new DataView(arraybuf);
            for (let i = 0; i < dv.byteLength; i++) { dv.setUint8(i, this.buffer[i]); }
            this.buffer = this.buffer.slice(this.length)
            this.read += dv.byteLength;
            this.callback(dv);
            this.offset += dv.byteLength;
        }
    }

    /**
     * Register a callback and length of waited data bytes
     * @param size waited bytes length
     * @param callback callback to be called when waited size reaxhed by parsing
     */
    wait(size, callback) {
        if (size < 0) throw new Error(`Non sense , never wait for less than 1 byte`);
        this.length = size;
        this.callback = callback;
    }

    skip(bytes: number, next: () => void) {
        this.wait(bytes, () => next())
    }
}

export interface GeofileIndexFeature {
    rank: number;
    pos: number;
    len: number;
    properties: object;
    bbox: number[];
}


interface GeofileIndexData {
    attribute: string;
    type: string;
    offset: number;
    buffer: ArrayBuffer;
    length: number;
}


export class GeofileIndexer {
    private idxlist: any[];
    private count: number;
    private parsers: GeofileParser[];
    private data: GeofileIndexFeature[];
    private header: ArrayBuffer;
    private metadata: ArrayBuffer;
    private handles: DataView;
    private indexes: GeofileIndexData[];
    private clusters: number[][];

    /** header total header size
     * tag:     char 8 bytes for tag,
     * count:   uint 4 bytes for feature count,
     * index:   uint 4 bytes for index count
     */
    private readonly HEADER_TSIZE = 16
    /** tag for file type checking geojson index  */
    private readonly HEADER_TAG = 'GEOFILEX'; // .map(function (c) { return c.charCodeAt(0); }));
    /** index metadata entry size
     * attribute:   char 50 bytes for attribute name,
     * type:        char 10 bytes for index type,
     * length:      uint 4 bytes for index data offset,
     * offset:      uint 4 bytes for index data length
     */
    private readonly METADAS_RSIZE = 68;
    /** total metadata size  (index count * METADA_RSIZE )*/
    private get METADATAS_TSIZE() { return this.METADAS_RSIZE * (this.idxlist.length + 2); }
    /** handles entry size
     * offset: uint 4 bytes offset in geojson file of the parsable GEOJSON object "{...}"
     * length: uint 4 bytes length of the GEOJSON parsable object
     * xminitile: uint 1 byte minitile x coordinate
     * yminitile: uint 1 byte minitile y coordinate
     */
    private get HANDLES_RSIZE() { return 10; }
    /** features in rtree are grouped by RTREE_CLUSTER_SIZE features */
    private get RTREE_CLUSTER_SIZE() { return 200; }

    private get INDEX_NEXT_OFFSET() {
        if (this.indexes.length > 0) {
            const lastidx = this.indexes[this.indexes.length - 1];
            return lastidx.offset + lastidx.buffer.byteLength;
        }
        return this.HEADER_TSIZE + this.METADATAS_TSIZE;
    }

    protected constructor(idxlist = [], parsers: GeofileParser[]) {
        this.idxlist = idxlist;
        this.count = 0;
        this.indexes = [];
        this.parsers = parsers;
    }

    get indexfilename() { return this.parsers[0].filename.replace(/\.[^\.]*$/, '') + '.idx'; }

    /** usage is ex: Geofile.index(filename, idxlist, new GeojsonParser()); => promise*/
    static index(idxlist = [], parsers: GeofileParser[]): Promise<void> {
        // create the indexer and start parsing
        const indexer = new GeofileIndexer(idxlist, parsers)
        return indexer.parseAll();
    }

    private parseAll(): Promise<void> {
        const start = Date.now();
        // check existence of mandatory files 
        return Promise.all(this.parsers.map(p => fs.FSFile.metadata(p.filename).catch(() => null)))
            .then((metadatas): Promise<any> => {
                if (metadatas.some(m => m === undefined || m === null)) {
                    throw new Error(`missing mandatory file ${this.parsers[metadatas.findIndex(m => m)].filename}`);
                }
                this.parsers.forEach((parser, i) => parser.mdate = metadatas[i].modificationTime)
                return fs.FSFile.metadata(this.indexfilename)
            })
            .then(metadata => {
                if (metadata && this.parsers.every(parser => parser.mdate < metadata.modificationTime)) {
                    console.log(`geofile index file ${this.indexfilename} indexes up-to-date`);
                    return null;
                } else {
                    // loop on each file to parse
                    return this.stream().then(_ => {
                        // all files parsed then collect data, build and write index
                        this.data = this.parsers[0].collection;
                        this.count = this.parsers[0].collection.length;
                        if (this.parsers[1]) {
                            this.data.forEach((pitem, i) => pitem.properties = this.parsers[1].collection[i].properties)
                        }
                        this.buildIndex();
                        return this.write().then(_ => {
                            const time = Date.now() - start;
                            console.log(`geofile index file ${this.indexfilename} wrote  (${this.count} features / ${time}ms)`);
                        });
                    })
                }
            })
    }
    /**
     * read the data from all the files to parse and write the data to the parsers 
     * @param datafile datafile structure
     * @param i index in filelist of the datafile
     */
    private stream(i = 0): Promise<void> {
        if (i < this.parsers.length) {
            const parser = this.parsers[i];
            return fs.FSFile.stream(parser.filename, fs.FSFormat.arraybuffer, (data: ArrayBuffer) => { parser.onData(data) })
                .then(() => this.stream(++i))
        };
        return Promise.resolve();
    }

    private buildIndex() {
        this.buildHeader();
        this.buildHandles();
        this.builRtree();
        this.buildAttributes();
        this.buildMetadata();
    }

    private buildHeader() {
        this.header = new ArrayBuffer(this.HEADER_TSIZE);
        const dv = new DataView(this.header);
        this.HEADER_TAG.split('').forEach((c: string, i) => dv.setUint8(i, c.charCodeAt(0)));
        dv.setUint32(this.HEADER_TAG.length, this.count);
        dv.setUint32(this.HEADER_TAG.length + 4, this.idxlist.length + 2);
    }

    private buildHandles() {
        if (!this.data) { return; }
        this.handles = new DataView(new ArrayBuffer(this.HANDLES_RSIZE * this.count));
        this.clusters = [];
        this.data.forEach((f) => {
            const offset = this.HANDLES_RSIZE * f.rank;
            this.handles.setUint32(offset, f.pos);
            this.handles.setUint32(offset + 4, f.len);
            // minitile values will calculated at indexGeometry (default to full tile)
            this.handles.setUint8(offset + 8, 0x00);
            this.handles.setUint8(offset + 9, 0xFF);
        });

        const metadata: GeofileIndexData = {
            attribute: 'rank',
            type: 'handle',
            buffer: this.handles.buffer,
            offset: this.INDEX_NEXT_OFFSET,
            length: this.handles.byteLength
        };
        this.indexes.push(metadata);
        console.log(`geojson handles    ${this.indexfilename} indexed / handles`);
    }

    private bboxextend(bounds: number[], bbox: number[]) {
        if (bbox) {
            if (bounds[0] == null || bbox[0] < bounds[0]) { bounds[0] = bbox[0]; }
            if (bounds[1] == null || bbox[1] < bounds[1]) { bounds[1] = bbox[1]; }
            if (bounds[2] == null || bbox[2] > bounds[2]) { bounds[2] = bbox[2]; }
            if (bounds[3] == null || bbox[3] > bounds[3]) { bounds[3] = bbox[3]; }
        }
        bounds[5]++;
    }

    private builRtree() {
        for (let i = 0; i < this.count; i += this.RTREE_CLUSTER_SIZE) {
            const bounds = [null, null, null, null, i, 0];
            for (let j = i; j < i + this.RTREE_CLUSTER_SIZE && j < this.count; j++) {
                const feature = this.data[j];
                const bbox = feature.bbox;
                this.bboxextend(bounds, bbox);
            }
            // check if some bounds is null
            if (!bounds.some(val => val === null)) {
                this.setMinitile(bounds);
                this.clusters.push(bounds);
            }
        }

        const tree = new binrbush();
        tree.load(this.clusters);
        const buffer = tree.toBinary();
        const metadata: GeofileIndexData = {
            attribute: 'geometry',
            type: 'rtree',
            buffer: buffer,
            offset: this.INDEX_NEXT_OFFSET,
            length: buffer.byteLength
        };
        this.indexes.push(metadata);
        console.log(`geojson rtree      ${this.indexfilename} indexed / geometry`);
    }

    private setMinitile(cluster: number[]) {
        if (!this.handles) { return; }
        const wtile = Math.abs(cluster[2] - cluster[0]) / 16;
        const htile = Math.abs(cluster[3] - cluster[1]) / 16;
        let xmin, ymin, xmax, ymax, pos, tmin, tmax, feature, bbox;
        const from = cluster[4];
        const to = cluster[4] + cluster[5];
        for (let rank = from; rank < to; rank++) {
            feature = this.data[rank];
            bbox = feature.bbox;
            if (bbox) {
                xmin = Math.floor(Math.abs(bbox[0] - cluster[0]) / wtile);
                xmax = Math.floor(Math.abs(bbox[2] - cluster[0]) / wtile);
                ymin = Math.floor(Math.abs(bbox[1] - cluster[1]) / htile);
                ymax = Math.floor(Math.abs(bbox[3] - cluster[1]) / htile);
                if (wtile === 0 || isNaN(xmax) || xmax > 15) { xmax = 15; }
                if (htile === 0 || ymax > 15) { ymax = 15; }
                if (wtile === 0 || isNaN(xmin)) { xmin = 0; }
                if (htile === 0 || isNaN(ymin)) { ymin = 0; }
                if (xmin > 15) { xmin = 15; }
                if (ymin > 15) { ymin = 15; }
                // tslint:disable-next-line:no-bitwise
                tmin = (xmin << 4) + ymin;
                // tslint:disable-next-line:no-bitwise
                tmax = (xmax << 4) + ymax;
                pos = rank * this.HANDLES_RSIZE;
                this.handles.setUint8(pos + 8, tmin);
                this.handles.setUint8(pos + 9, tmax);
            }
        }
    }

    private buildMetadata() {
        // attribute: 50 bytes (string) name of the indexed attribute ('rank' for handle and 'geometry' for geometry)
        // type: 10 bytes (string) index type (handle,rtree,ordered,fuzzy)
        // buffer: 4 bytes (uint32) offset du debut du buffer de l'index
        // length: 4 bytes (uint32) longueur du buffer de l'index
        const ATTR_OFFSET = 0;
        const TYPE_OFFSET = 50;
        const OFFS_OFFSET = 60;
        const LEN_OFFSET = 64;

        this.metadata = new ArrayBuffer(this.METADAS_RSIZE * this.indexes.length);
        const dv = new DataView(this.metadata);
        let offset = 0;

        this.indexes.forEach((index, i) => {
            for (let c = 0; c < this.METADAS_RSIZE; c++) { dv.setUint8(offset + c, 0); }
            index.attribute.split('').forEach((vcar, icar) => dv.setUint8(offset + ATTR_OFFSET + icar, vcar.charCodeAt(0)));
            index.type.split('').forEach((vcar, icar) => dv.setUint8(offset + TYPE_OFFSET + icar, vcar.charCodeAt(0)));
            dv.setUint32(offset + OFFS_OFFSET, index.offset);
            dv.setUint32(offset + LEN_OFFSET, index.length);
            offset += this.METADAS_RSIZE;
        });
    }



    buildAttributes() {
        // Creation des index Attributs
        for (let i = 0; i < this.idxlist.length; i++) {
            const attr = this.idxlist[i].attribute;
            const type = this.idxlist[i].type;
            switch (type) {
                case 'ordered': this.buildOrderedIndex(attr);
                    break;
                case 'fuzzy': this.buildFuzzyIndex(attr);
                    break;
                case 'prefix': this.buildPrefixIndex(attr);
                    break;
                case 'rtree':
                case 'handle':
                    break;
                default: throw new Error(`geofile index file ${this.indexfilename} undefined index type  "${type}" for attribute "${attr}"`)
            }
        }
    }

    buildOrderedIndex(attr: string) {
        const attlist = [];
        for (let i = 0; i < this.count; i++) {
            const feature = this.data[i];
            const val = feature.properties[attr];
            attlist.push({ value: val, rank: i });
        }
        // on ordonne sur les valeurs de l'attribut
        attlist.sort(function (a, b) { return (a.value < b.value) ? -1 : (a.value > b.value) ? 1 : 0; });
        const buf = new ArrayBuffer(4 * attlist.length);
        const dv = new DataView(buf);
        attlist.forEach((att, i) => {
            dv.setUint32(i * 4, att.rank);
            // console.log(`${att.rank} ==> ${att.value}`)
        });

        const metadata = {
            attribute: attr,
            type: 'ordered',
            buffer: buf,
            offset: this.INDEX_NEXT_OFFSET,
            length: buf.byteLength
        };
        console.log(`geojson ordered    ${this.indexfilename} indexed / ${attr}`);
        this.indexes.push(metadata);
    }

    buildFuzzyIndex(attr: string) {
        const attlist: { hash: number, rank: number }[] = [];
        for (let i = 0; i < this.count; i++) {
            const feature = this.data[i];
            const val = feature.properties[attr];
            const hash = val ? val.fuzzyhash() : 0;
            attlist.push({ hash: hash, rank: i });
        }
        // we sort on fuzzyhash value
        attlist.sort(function (a, b) { return (a.hash < b.hash) ? -1 : (a.hash > b.hash) ? 1 : 0; });
        const buf = new ArrayBuffer(4 * attlist.length);
        const dv = new DataView(buf);
        attlist.forEach((att, i) => dv.setUint32(i * 4, att.rank));

        const metadata = {
            attribute: attr,
            type: 'fuzzy',
            buffer: buf,
            offset: this.INDEX_NEXT_OFFSET,
            length: buf.byteLength
        };
        this.indexes.push(metadata);
        console.log(`geojson fuzzy      ${this.indexfilename} indexed / ${attr}`);
    }

    buildPrefixIndex(attr: string) {
        // collecting prefix tuples
        const preflist: { value: string, rank: number }[] = [];
        for (let i = 0; i < this.count; i++) {
            const feature = this.data[i];
            const val = feature.properties[attr];
            const wlist = val ? (val + '').wordlist() : [];
            // console.log(val); console.log(wlist);
            wlist.forEach((w: string) => preflist.push({ value: w.substring(0, 4), rank: i }));
        }

        // we sort on prefix
        preflist.sort(function (a, b) { return (a.value < b.value) ? -1 : (a.value > b.value) ? 1 : (a.rank - b.rank); });
        const buf = new ArrayBuffer(8 * preflist.length);
        const dv = new DataView(buf);
        preflist.forEach((att, i) => {
            [32, 32, 32, 32].forEach((c, idx) => dv.setUint8(i * 8 + idx, c)); // white padding
            att.value.split('').forEach((c, idx) => dv.setUint8(i * 8 + idx, c.charCodeAt(0)));
            dv.setUint32(i * 8 + 4, att.rank);
        });

        const metadata = {
            attribute: attr,
            type: 'prefix',
            buffer: buf,
            offset: this.INDEX_NEXT_OFFSET,
            length: buf.byteLength
        };
        this.indexes.push(metadata);
        console.log(`geojson prefix     ${this.indexfilename} indexed / ${attr}`);
    }

    write(): Promise<number> {
        const total = this.header.byteLength + this.metadata.byteLength + this.indexes.reduce((p, c) => p + c.buffer.byteLength, 0);
        const buf = new ArrayBuffer(total);
        const target = new Uint8Array(buf);
        let offset = 0;
        // copying data in one buffer 
        (new Uint8Array(this.header)).forEach((val, i) => target[offset++] = val);
        (new Uint8Array(this.metadata)).forEach((val, i) => target[offset++] = val);;
        this.indexes.forEach((index) => {
            (new Uint8Array(index.buffer)).forEach((val, i) => target[offset++] = val);
        });
        return fs.FSFile.write(this.indexfilename, buf)
    }

}
