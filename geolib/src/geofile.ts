'use strict';
import * as ol from './ol-debug';
import { _ } from './polyfill';
import { BinRtree } from './binrtree';
import { FSFile, FSFormat } from './sync';
_();

const WGS84SPHERE = new ol.Sphere(6378137);
const WGS84 = ol.proj.get('EPSG:4326');
const HANDLE_SIZE = 10;
const INDEX_MD_SIZE = 68;


export class GeofileFeature extends ol.Feature {
    rank: number;
    proj: ol.proj.Projection;
    geofile: Geofile;
    distance: number;
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
    style?: ol.StyleFunction | ol.style.Style | ol.style.Style[];
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
    proj?: ol.proj.Projection;
    /** do not use (used for internal index filtering ) */
    _filter?: Function[];
    /** filter function only features that match this test function are returned*/
    filter?: Function;
    /** action function applied to all returned features (caution! above projection applied)*/
    action?: Function;
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

/**
 * File System spatial data class
 */
export abstract class Geofile {

    /** if true time statistics are logged */
    private static TIMEON = true;
    /** default style of Geofile class when not given */
    static readonly style = DEFAULT_STYLE;
    /* geofile objects set */
    private static readonly ALL = new Map<string, Geofile>();

    /** geofile dataset file name  */
    readonly filename: string;
    /** geofile dataset projection name */
    readonly srs: string;
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
    readonly style: ol.StyleFunction | ol.style.Style | ol.style.Style[];
    /** geofile dataset projection calculated through this.srs */
    readonly proj: ol.proj.Projection;
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
                    feature.setId(this.name + '_' + rank);
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
        if (rank < 0 || rank >= this.count) {return Promise.resolve([]); }
        if (count <= 0) {return Promise.resolve([]); }
        count = Math.min(count , this.count - rank);
        return this.getFeatures_(rank, count, options)
            .then(features => {
                const result = [];
                features.forEach(feature => {
                    feature.setId(this.name + '_' + rank);
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
        this['' + 'srs'] = opts.srs || 'EPSG:4326';
        this['' + 'minscale'] = opts.minscale || 0;
        this['' + 'maxscale'] = opts.maxscale || 10000;
        this['' + 'name'] = opts.name || this.filename.split('\\').pop().split('/').pop();
        this['' + 'title'] = opts.title || this.name;
        this['' + 'group'] = opts.group || 'root';
        this['' + 'style'] = opts.style || Geofile.style;
        this['' + 'proj'] = ol.proj.get(this.srs);
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
        return FSFile.read(this.confname, FSFormat.text)
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
        return FSFile.read(this.idxname, FSFormat.arraybuffer)
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
    private clusterBbox(rank: number, cluster: number[]): ol.Extent {
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
            feature.getGeometry().transform((feature as any).proj, options.proj);
            (feature as any).proj = options.proj;
        }
        if (options.filter && !options.filter(feature)) { return undefined; }
        if (options.action) { options.action(feature); }
        return feature;
    }

    private setFilter(opts: GeofileFilterOptions, filter: Function) {
        const options: GeofileFilterOptions = opts.applyTo({ _filter: [] });
        options._filter.push(filter);
        return options;
    }

    /** return true if bbox1 intersects bbox2, false otherwise */
    private intersects(bbox1: ol.Extent, bbox2: ol.Extent): boolean {
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

    bboxSearch(bbox: ol.Extent, options: GeofileFilterOptions = {}): Promise<GeofileFeature[]> {
        this.assertLoaded();
        const projbbox = options.proj ? ol.proj.transformExtent(bbox, this.proj, options.proj) : null;
        const start = Date.now();

        options = this.setFilter(options, (feature: GeofileFeature) => {
            const geom = feature.getGeometry();
            const abbox = (feature.proj === options.proj) ? projbbox : bbox;
            const res = (geom && (geom as any).intersectsExtent) ? (geom as any).intersectsExtent(abbox) : false;
            return res;
        });

        // parcours de l'index geographique.
        const bboxlist = this.rtree.search(bbox).filter(ibbox => this.intersects(ibbox, bbox));
        const promises = bboxlist.map( ibbox => {
            return this.getFeatures(ibbox[4], ibbox[5], options );
        });
        const selectivity = Math.round( 100 * bboxlist.reduce((p, c) => p + c[5], 0) / this.count );

        return Promise.cleanPromiseAll(promises)
        .then((features) => {
            const elapsed = (Date.now() - start) ;
            const best = Math.round( 100 * features.length / this.count );
            const objsec =  Math.round( features.length / (elapsed / 1000) );
            console.log(`Geofile.bboxSearch [${this.name}]: ${features.length} o / ${ elapsed } ms /  ${objsec} obj/s sel: ${selectivity}% (vs ${best}%)`);
            return features;
        });
    }

    addIndexTiles(map: ol.Map) {
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

    pointSearch(lon: number, lat: number, options: GeofileFilterOptions = {}): Promise<GeofileFeature[]> {
        this.assertLoaded();
        const tol = options.tolerance ? options.tolerance : 0.00001;
        options = this.setFilter(options, (feature) => {
            ol.proj.transform([lon, lat], this.proj, feature.proj);
            return feature.getGeometry().intersectsCoordinate([lon, lat]);
        });
        return this.bboxSearch([lon - tol, lat - tol, lon + tol, lat + tol], options);
    }

    /**
     * search and return the nearest feature arround a point
     * @param gjspt a generic point
     * @param rorb raduis or bbox
     * @param options filter options
     */
    nearestSearch(lon: number, lat: number, rorb: number | ol.Extent, options: GeofileFilterOptions = {}): Promise<GeofileFeature> {
        this.assertLoaded();
        const wgs84pt = ol.proj.transform([lon, lat], this.proj, WGS84);
        let bbox;
        if (Array.isArray(rorb)) {
            bbox = rorb;
        } else {
            const unitpermeter = 1 / this.proj.getMetersPerUnit();
            const wgs84r = rorb * unitpermeter;
            bbox = [wgs84pt[0] - wgs84r, wgs84pt[1] - wgs84r, wgs84pt[0] + wgs84r, wgs84pt[1] + wgs84r];
            options = this.setFilter(options, (feature) => {
                const closest = feature.getGeometry().getClosestPoint([lon, lat]);
                const closest_wgs84 = ol.proj.transform(closest, feature.proj, WGS84);
                feature.distance = WGS84SPHERE.haversineDistance(wgs84pt, closest_wgs84);
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
        options = this.setFilter(options, f => clean.levenshtein(f.get(attr).clean()) < maxlevens );
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
    getScale(resolution: number, projection: ol.proj.Projection): number {
        // const units = projection.getUnits();
        const dpi = 25.4 / 0.28;
        const mpu = projection.getMetersPerUnit(); // MBZ TODO A REVOIR CALCUL D'ECHELLE
        const scale = resolution * mpu * 39.37 * dpi;
        return scale;
    }

    /**
     * get resolution from scale
     * @param scale a scale
     * @param projection the target map projectiion
     * @returns corresponding resolution for scale
     */
    getResolution(scale: number, projection: ol.proj.Projection): number {
        // const units = projection.getUnits();
        const dpi = 25.4 / 0.28;
        const mpu = projection.getMetersPerUnit(); // MBZ TODO A REVOIR CALCUL D'ECHELLE
        const resolution = scale / (mpu * 39.37 * dpi);
        return resolution;
    }

    /**
     * add this geofile to an openlayer Map as an ol.layer.Vector
     * @param map an openlayers 3+ Map
     */
    addAsVector(map: ol.Map) {
        let last_extent = ol.extent.createEmpty();
        const cache = this.newCache();
        let vsource: ol.source.Vector;

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
                        vsource.addFeatures(features);
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
            style: this.style,
            minResolution: this.getResolution(this.minscale, map.getView().getProjection()),
            maxResolution: this.getResolution(this.maxscale, map.getView().getProjection())
        });
        map.addLayer(vlayer);
        return vlayer;
    }
}
