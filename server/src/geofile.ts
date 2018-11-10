import { binrbush } from './binrbush';
import { FSDir, FSFile, FSFormat } from './sync';
import { _ } from './polyfill';
import { promises } from 'fs';
_();

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

// export type GeofileDatafile = { type: GeofileFiletype, filename: string, mandatory: boolean, mdate?: Date };

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

export class GeojsonBinaryParser implements GeofileParser {
    // implements GeofileParser
    readonly type: GeofileFiletype;
    readonly collection: GeofileIndexFeature[] = [];
    readonly filename: string;
    mandatory: boolean = true;
    mdate: Date = null;

    protected offset: number = 0;                         // offset in the file of the first byte in buffer
    protected read: number = 0;                         // bytes read (but not treated between offset and read )
    private length: number = 0;                 // waiting for length bytes before calling callback
    private callback: (dv: DataView) => void;   // callback to transform received data
    private buffer: number[] = [];                // buffered data

    constructor(filename: string, type: GeofileFiletype, mandatory: boolean) {
        this.filename = filename;
        this.type = type;
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
        return Promise.all(this.parsers.map(p => FSFile.metadata(p.filename).catch(() => null)))
            .then((metadatas): Promise<any> => {
                if (metadatas.some(m => m === undefined || m === null)) {
                    throw new Error(`missing mandatory file ${this.parsers[metadatas.findIndex(m => m)].filename}`);
                }
                this.parsers.forEach((parser, i) => parser.mdate = metadatas[i].modificationTime)
                return FSFile.metadata(this.indexfilename)
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
            return FSFile.stream(parser.filename, FSFormat.arraybuffer, (data: ArrayBuffer) => { parser.onData(data) })
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
            return FSFile.write(this.indexfilename, buf)
    }

}
