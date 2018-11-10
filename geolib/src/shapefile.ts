import * as ol from './ol-debug';
import { Geofile, GeofileFeature, GeofileOptions, GeofileFilterOptions } from './geofile';
import { FSFile, FSFormat } from './sync';

interface ShpHeader {
    code: number;
    length: number;
    version: number;
    type: number;
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
    zmin: number;
    zmax: number;
    mmin: number;
    mmax: number;
}

interface DbfHeader {
    code: number;
    lastUpdate: Date;
    count: number;
    headerSize: number;
    recordSize: number;
    encrypted: number;
}

interface DbfField {
    name: string;
    type: string;
    offset: number;
    length: number;
    decimal: number;
}

enum GEOMTYPE {
    NullShape = 0,
    Point = 1,
    PolyLine = 3,
    Polygon = 5,
    MultiPoint = 8,
    PointZ = 11,
    PolyLineZ = 13,
    PolygonZ = 15,
    MultiPointZ = 18,
    PointM = 21,
    PolyLineM = 23,
    PolygonM = 25,
    MultiPointM = 28,
    MultiPatch = 31
}


export class Shapefile extends Geofile {

    shpfile: File;
    dbffile: File;
    shpheader: ShpHeader;
    dbfheader: DbfHeader;
    fields: Map<string, DbfField> = new Map();

    /** dbf file name associated to the shapefile */
    get dbfname() { return this.filename.replace(/\.[^/.]+$/, '') + '.dbf'; }

    static get(filename: string, opts: GeofileOptions = {}): Promise<Geofile> {
        const shapefile = new Shapefile(filename, opts);
        return shapefile.load();
    }

    /** construct a Geojson object (dont use private use static geosjon() method) */
    private constructor(filename: string, opts: GeofileOptions = {}) {
        super(filename, opts);
    }

    /** internal method to get File object for Shapefile for random access */
    loadFeatures(): Promise<any> {
        return FSFile.get(this.filename)
            .then(file => { this.shpfile = file; })
            .then(() => FSFile.get(this.dbfname))
            .then(file => {
                this.dbffile = file;
                // _this.adv = new DataView(this.result);
                // _this.attrData = this.result;
                // _this.readDbfHeader();
                // _this.readFields();
            })
            .then(() => this.loadShpHeader())
            .then(() => this.loadDbfHeader())
            .then(() => this.loadDbfFields());
    }


    /*
    Position    Field                   Value   Type        Order
    Byte 0      File Code               9994    Integer     Big
    Byte 4      Unused                  0       Integer     Big
    Byte 8      Unused                  0       Integer     Big
    Byte 12     Unused                  0       Integer     Big
    Byte 16     Unused                  0       Integer     Big
    Byte 20     Unused                  0       Integer     Big
    Byte 24     File Length             length  Integer     Big
    Byte 28     Version                 1000    Integer     Little
    Byte 32     Shape Type              shptype Integer     Little
    Byte 36     Bounding Box            Xmin    Double      Little
    Byte 44     Bounding Box            Ymin    Double      Little
    Byte 52     Bounding Box            Xmax    Double      Little
    Byte 60     Bounding Box            Ymax    Double      Little
    Byte 68*    Bounding Box            Zmin    Double      Little
    Byte 76*    Bounding Box            Zmax    Double      Little
    Byte 84*    Bounding Box            Mmin    Double      Little
    Byte 92*    Bounding Box            Mmax    Double      Little
    */
    loadShpHeader(): Promise<any> {
        return FSFile.slice(this.shpfile, FSFormat.arraybuffer, 0, 100)
            .then(buffer => {
                const dv = new DataView(buffer);
                const code = dv.getInt32(0);
                const length = dv.getInt32(24) * 2;
                const version = dv.getInt32(28, true);
                const type = dv.getInt32(32, true);
                const xmin = dv.getFloat64(36, true);
                const ymin = dv.getFloat64(44, true);
                const xmax = dv.getFloat64(52, true);
                const ymax = dv.getFloat64(60, true);
                const zmin = dv.getFloat64(68, true);
                const zmax = dv.getFloat64(76, true);
                const mmin = dv.getFloat64(84, true);
                const mmax = dv.getFloat64(92, true);
                this.shpheader = { code, length, version, type, xmin, ymin, xmax, ymax, zmin, zmax, mmin, mmax };
            });
    }

    /**
      * 00	    FoxBase+, FoxPro, dBaseIII+, dBaseIV, no memo - 0x03
      * 01-03   Last update, format YYYYMMDD   **correction: it is YYMMDD**
      * 04-07	Number of records in file (32-bit number)
      * 08-09	Number of bytes in header (16-bit number)
      * 10-11	Number of bytes in record (16-bit number)
      * 12-13	Reserved, fill with 0x00
      * 14	    dBaseIV flag, incomplete transaction
      *         Begin Transaction sets it to 0x01
      *         End Transaction or RollBack reset it to 0x00
      * 15      Encryption flag, encrypted 0x01 else 0x00
      *         Changing the flag does not encrypt or decrypt the records
      * 16-27   dBaseIV multi-user environment use
      * 28	    Production index exists - 0x01 else 0x00
      * 29	    dBaseIV language driver ID
      * 30-31   Reserved fill with 0x00
      * 32-n	Field Descriptor array
      * n+1	    Header Record Terminator - 0x0D
    */
    loadDbfHeader(): Promise<any> {
        return FSFile.slice(this.dbffile, FSFormat.arraybuffer, 0, 32)
            .then(buffer => {
                const dv = new DataView(buffer);
                this.dbfheader = {
                    code: dv.getUint8(0),
                    lastUpdate: new Date(1900 + dv.getUint8(1), dv.getUint8(2) - 1, dv.getUint8(3)),
                    count: dv.getUint32(4, true),
                    headerSize: dv.getUint16(8, true),
                    recordSize: dv.getUint16(10, true),
                    encrypted: dv.getUint8(15)
                };
            });
    }

    loadDbfFields() {
        const fldsize = this.dbfheader.headerSize - 33;
        return FSFile.slice(this.dbffile, FSFormat.arraybuffer, 32, 32 + fldsize)
            .then(buffer => {
                const dv = new DataView(buffer);
                let offset = 0;
                for (let pos = 0; pos < fldsize; pos += 32) {
                    const field = {
                        name: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i =>
                            String.fromCharCode(dv.getUint8(pos + i))
                        ).join('').trimzero(),
                        type: String.fromCharCode(dv.getUint8(pos + 11)),
                        offset: offset,
                        length: dv.getUint8(pos + 16),
                        decimal: dv.getUint8(pos + 17)
                    };
                    this.fields.set(field.name, field);
                    offset += field.length;
                }
            });
    }

    getFeature_(rank: number, options: GeofileFilterOptions): Promise<GeofileFeature> {
        const handle = this.getHandle(rank);
        const attrpos = this.dbfheader.headerSize + (handle.rank * this.dbfheader.recordSize) + 1;

        const promiseg = FSFile.slice(this.shpfile, FSFormat.arraybuffer, handle.pos, handle.len)
            .then(buffer => {
                const dv = new DataView(buffer);
                const geom = this.geometryReader(dv);
                const feature = <GeofileFeature>new ol.Feature(geom);
                return feature;
            });
        const promisea = FSFile.slice(this.dbffile, FSFormat.arraybuffer, attrpos, attrpos + this.dbfheader.recordSize)
            .then(buffer => {
                const dv = new DataView(buffer);
                const properties = this.propertiesReader(dv);
                return properties;
            });
        return Promise.all([promiseg, promisea])
            .then((arr: [GeofileFeature, Object]) => {
                const feature = arr[0];
                const properties = arr[1];
                feature.setProperties(properties);
                return feature;
            });
    }

    getFeatures_(rank: number, count: number, options: GeofileFilterOptions): Promise<GeofileFeature[]> {
        const hmin = this.getHandle(rank);
        const hmax = this.getHandle(rank + count - 1);
        const length = (hmax.pos + hmax.len - hmin.pos);
        const promiseg = FSFile.slice(this.shpfile, FSFormat.arraybuffer, hmin.pos, length)
            .then(buffer => {
                const features = [];
                for (let i = 0; i < count; i++) {
                    const handle = this.getHandle(rank);
                    const dv = new DataView(buffer, handle.pos - hmin.pos, handle.len);
                    const geom = this.geometryReader(dv);
                    const feature = new ol.Feature(geom);
                    features.push(feature);
                    rank += 1;
                }
                return features;
            });
        const attrpmin = this.dbfheader.headerSize + (hmin.rank * this.dbfheader.recordSize) + 1;
        const attrlen = count * this.dbfheader.recordSize;
        const promisea = FSFile.slice(this.dbffile, FSFormat.arraybuffer, attrpmin, attrlen)
            .then(buffer => {
                const propsarr = [];
                for (let i = 0; i < count; i++) {
                    const dv = new DataView(buffer, (i * this.dbfheader.recordSize), this.dbfheader.recordSize);
                    const properties = this.propertiesReader(dv);
                    propsarr.push(properties);
                }
                return propsarr;
            });
        return Promise.all([promiseg, promisea])
            .then((arr) => {
                const featgeoms = arr[0];
                const propsarr = arr[1];
                const features = featgeoms.map((feature, i) => {
                    const properties = propsarr[i];
                    feature.setProperties(properties);
                    return feature;
                });
                return features;
            });

    }

    propertiesReader(dv: DataView) {
        const td = new TextDecoder('utf8');
        const properties = new Object();
        this.fields.forEach((field, name) => {
            // type = C (Character) All OEM code page characters.
            // type = D (Date) Numbers and a character to separate month, day, and year
            //                 (stored internally as 8 digits in YYYYMMDD format).
            // type = F (Floating - . 0 1 2 3 4 5 6 7 8 9 point binary numeric)
            // type = N (Binary - . 0 1 2 3 4 5 6 7 8 9 coded decimal numeric)
            // type = L (Logical) ? Y y N n T t F f (? when not initialized).
            // type = M (Memo) All OEM code page characters (stored internally as 10 digits representing a .DBT block number).
            let value = null;
            const offset = dv.byteOffset + field.offset;
            switch (field.type) {
                case 'C':
                case 'M':
                    value = td.decode(dv.buffer.slice(offset, offset + field.length)).trimzero().trim();
                    break;
                case 'D':
                    const yyyy = td.decode(dv.buffer.slice(offset, offset + 4));
                    const mm = td.decode(dv.buffer.slice(offset + 4, offset + 6));
                    const dd = td.decode(dv.buffer.slice(offset + 6, offset + 8));
                    value = new Date(parseInt(yyyy, 10), parseInt(mm, 10), parseInt(dd, 10));
                    break;
                case 'F':
                case 'N':
                    value = td.decode(dv.buffer.slice(offset, offset + field.length)).trimzero().trim();
                    value = parseFloat(value);
                    break;
                case 'I':
                    value = td.decode(dv.buffer.slice(offset, offset + field.length)).trimzero().trim();
                    value = parseInt(value, 10);
                    break;
                case 'L':
                    value = td.decode(dv.buffer.slice(offset, offset + field.length)).trimzero().trim();
                    value = ['Y', 'y', 'T', 't'].indexOf(value) >= 0;
                    break;
                default:
                    value = td.decode(dv.buffer.slice(offset, offset + field.length)).trimzero().trim();
            }
            properties[name] = value;
        });
        return properties;
    }

    getbbox(dv: DataView, pos: number) {
        return [dv.getFloat64(pos, true), dv.getFloat64(pos + 8, true), dv.getFloat64(pos + 16, true), dv.getFloat64(pos + 24, true)];
    }

    geometryReader(dv: DataView): ol.geom.Geometry {
        const geomtype: GEOMTYPE = dv.getInt32(0, true);
        switch (geomtype) {
            case GEOMTYPE.Point: return this.geomPoint(dv);
            case GEOMTYPE.PolyLine: return this.geomPolyLine(dv);
            case GEOMTYPE.Polygon: return this.geomPolygon(dv);
            case GEOMTYPE.MultiPoint: return this.geomMultiPoint(dv);
            case GEOMTYPE.NullShape:
            case GEOMTYPE.PointZ:
            case GEOMTYPE.PolyLineZ:
            case GEOMTYPE.PolygonZ:
            case GEOMTYPE.MultiPointZ:
            case GEOMTYPE.PointM:
            case GEOMTYPE.PolyLineM:
            case GEOMTYPE.PolygonM:
            case GEOMTYPE.MultiPointM:
            case GEOMTYPE.MultiPatch:
            default: return this.geomNullShape(dv);
        }
        return null;
    }
    /**
     * Type Null
     * Position    Field       Value   Type    Number  Byte Order
     * Byte 0      Shape Type  0       Integer 1       Little
     */
    geomNullShape(dv: DataView) {
        return null;
    }
    /**
     *  read a point geometry from the dataview
     *  Type Point
     *  Position    Field       Value   Type    Number  Byte Order
     *  Byte 0      Shape Type  1       Integer 1       Little
     *  Byte 4      X           X       Double  1       Little
     *  Byte 12     Y           Y       Double  1       Little
     */
    private geomPoint(dv: DataView) {
        const x = dv.getFloat64(4, true);
        const y = dv.getFloat64(12, true);
        return new ol.geom.Point([x, y]);
    }
    /**
     *  read a polyline geometry from the dataview
     *  Position    Field       Value       Type    Number      Byte Order
     *  Byte 0      Shape Type  3           Integer 1           Little
     *  Byte 4      Box         Box         Double  4           Little
     *  Byte 36     NumParts    NumParts    Integer 1           Little
     *  Byte 40     NumPoints   NumPoints   Integer 1           Little
     *  Byte 44     Parts       Parts       Integer NumParts    Little
     *  Byte X      Points      Points      Point   NumPoints   Little
     *
     *  Note: X = 44 + 4 * NumParts
     */
    geomPolyLine(dv: DataView) {
        const parts = [];
        const lring = [];
        const numparts = dv.getInt32(36, true);
        const numpoints = dv.getInt32(40, true);
        let ppos = 44;
        for (let part = 0; part < numparts; part++) {
            parts.push(dv.getInt32(ppos + (part * 4), true));
        }
        ppos = 44 + (4 * numparts);
        while (parts.length > 0) {
            const deb = 2 * 8 * parts.shift();
            const fin = 2 * 8 * ((parts.length > 0) ? parts[0] : numpoints);
            for (let i = deb; i < fin; i += 16) {
                const x = dv.getFloat64(ppos + i, true);
                const y = dv.getFloat64(ppos + i + 8, true);
                lring.push([x, y]);
            }
        }
        return new ol.geom.LineString(lring);
    }
    /**
     *  Type Polygon
     *  Position    Field       Value       Type    Number      Byte Order
     *  Byte 0      Shape Type  5           Integer 1           Little
     *  Byte 4      Box         Box         Double  4           Little
     *  Byte 36     NumParts    NumParts    Integer 1           Little
     *  Byte 40     NumPoints   NumPoints   Integer 1           Little
     *  Byte 44     Parts       Parts       Integer NumParts    Little
     *  Byte X      Points      Points      Point   NumPoints   Little
     *
     *  Note: X = 44 + 4 * NumParts
     */
    geomPolygon(dv: DataView) {
        const numparts = dv.getInt32(36, true);
        const numpoints = dv.getInt32(40, true);
        const parts = [];
        let ppos = 44;
        for (let part = 0; part < numparts; part++) {
            parts.push(dv.getInt32(ppos + (part * 4), true));
        }
        ppos = 44 + (4 * numparts);
        const mpolygon = [];
        while (parts.length > 0) {
            const lring = [];
            const deb = 2 * 8 * parts.shift();
            const fin = 2 * 8 * ((parts.length > 0) ? parts[0] : numpoints);
            for (let i = deb; i < fin; i += 16) {
                const x = dv.getFloat64(ppos + i, true);
                const y = dv.getFloat64(ppos + i + 8, true);
                lring.push([x, y]);
            }
            lring.push(lring[0]);
            mpolygon.push([lring]);

        }
        return new ol.geom.MultiPolygon(mpolygon);
    }
    /**
     *  Type Point
     * Position    Field       Value       Type        Number      Byte Order
     * Byte 0      Shape Type  8           Integer     1           Little
     * Byte 4      Box         Box         Double      4           Little
     * Byte 36     NumPoints   NumPoints   Integer     1           Little
     * Byte 40     Points      Points      Point       NumPoints   Little
     */
    geomMultiPoint(dv: DataView) {
        const numpoints = dv.getInt32(36, true);
        const points = [];
        let ipos = 40;
        for (let i = 0; i < numpoints; i++) {
            const x = dv.getFloat64(ipos, true);
            const y = dv.getFloat64(ipos + 8, true);
            points.push([x, y]);
            ipos += 16;
        }
        return new ol.geom.MultiPoint(points);
    }
}
