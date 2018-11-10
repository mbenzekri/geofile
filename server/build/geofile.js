"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var binrbush_1 = require("./binrbush");
var sync_1 = require("./sync");
var polyfill_1 = require("./polyfill");
polyfill_1._();
var GeofileFiletype;
(function (GeofileFiletype) {
    GeofileFiletype[GeofileFiletype["CSV"] = 0] = "CSV";
    GeofileFiletype[GeofileFiletype["GEOJSON"] = 1] = "GEOJSON";
    GeofileFiletype[GeofileFiletype["SHP"] = 2] = "SHP";
    GeofileFiletype[GeofileFiletype["DBF"] = 3] = "DBF";
    GeofileFiletype[GeofileFiletype["PRJ"] = 4] = "PRJ";
    GeofileFiletype[GeofileFiletype["GML2"] = 5] = "GML2";
    GeofileFiletype[GeofileFiletype["GML3"] = 6] = "GML3";
    GeofileFiletype[GeofileFiletype["KML"] = 7] = "KML";
})(GeofileFiletype = exports.GeofileFiletype || (exports.GeofileFiletype = {}));
var GeojsonBinaryParser = /** @class */ (function () {
    function GeojsonBinaryParser(filename, type, mandatory) {
        this.collection = [];
        this.mandatory = true;
        this.mdate = null;
        this.offset = 0; // offset in the file of the first byte in buffer
        this.read = 0; // bytes read (but not treated between offset and read )
        this.length = 0; // waiting for length bytes before calling callback
        this.buffer = []; // buffered data
        this.filename = filename;
        this.type = type;
    }
    /**
     * data to be provided to the parser.
     * @param arrbuf data array buffer to be pushed to the parser
     */
    GeojsonBinaryParser.prototype.onData = function (arrbuf) {
        for (var i = 0, dv_1 = new DataView(arrbuf); i < dv_1.byteLength; i++) {
            this.buffer.push(dv_1.getUint8(i));
        }
        ;
        while (this.length <= this.buffer.length) {
            // waited length data reached calling callback
            var arraybuf = new ArrayBuffer(this.length);
            var dv = new DataView(arraybuf);
            for (var i = 0; i < dv.byteLength; i++) {
                dv.setUint8(i, this.buffer[i]);
            }
            this.buffer = this.buffer.slice(this.length);
            this.read += dv.byteLength;
            this.callback(dv);
            this.offset += dv.byteLength;
        }
    };
    /**
     * Register a callback and length of waited data bytes
     * @param size waited bytes length
     * @param callback callback to be called when waited size reaxhed by parsing
     */
    GeojsonBinaryParser.prototype.wait = function (size, callback) {
        if (size < 0)
            throw new Error("Non sense , never wait for less than 1 byte");
        this.length = size;
        this.callback = callback;
    };
    GeojsonBinaryParser.prototype.skip = function (bytes, next) {
        this.wait(bytes, function () { return next(); });
    };
    return GeojsonBinaryParser;
}());
exports.GeojsonBinaryParser = GeojsonBinaryParser;
var GeofileIndexer = /** @class */ (function () {
    function GeofileIndexer(idxlist, parsers) {
        if (idxlist === void 0) { idxlist = []; }
        /** header total header size
         * tag:     char 8 bytes for tag,
         * count:   uint 4 bytes for feature count,
         * index:   uint 4 bytes for index count
         */
        this.HEADER_TSIZE = 16;
        /** tag for file type checking geojson index  */
        this.HEADER_TAG = 'GEOFILEX'; // .map(function (c) { return c.charCodeAt(0); }));
        /** index metadata entry size
         * attribute:   char 50 bytes for attribute name,
         * type:        char 10 bytes for index type,
         * length:      uint 4 bytes for index data offset,
         * offset:      uint 4 bytes for index data length
         */
        this.METADAS_RSIZE = 68;
        this.idxlist = idxlist;
        this.count = 0;
        this.indexes = [];
        this.parsers = parsers;
    }
    Object.defineProperty(GeofileIndexer.prototype, "METADATAS_TSIZE", {
        /** total metadata size  (index count * METADA_RSIZE )*/
        get: function () { return this.METADAS_RSIZE * (this.idxlist.length + 2); },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GeofileIndexer.prototype, "HANDLES_RSIZE", {
        /** handles entry size
         * offset: uint 4 bytes offset in geojson file of the parsable GEOJSON object "{...}"
         * length: uint 4 bytes length of the GEOJSON parsable object
         * xminitile: uint 1 byte minitile x coordinate
         * yminitile: uint 1 byte minitile y coordinate
         */
        get: function () { return 10; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GeofileIndexer.prototype, "RTREE_CLUSTER_SIZE", {
        /** features in rtree are grouped by RTREE_CLUSTER_SIZE features */
        get: function () { return 200; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GeofileIndexer.prototype, "INDEX_NEXT_OFFSET", {
        get: function () {
            if (this.indexes.length > 0) {
                var lastidx = this.indexes[this.indexes.length - 1];
                return lastidx.offset + lastidx.buffer.byteLength;
            }
            return this.HEADER_TSIZE + this.METADATAS_TSIZE;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GeofileIndexer.prototype, "indexfilename", {
        get: function () { return this.parsers[0].filename.replace(/\.[^\.]*$/, '') + '.idx'; },
        enumerable: true,
        configurable: true
    });
    /** usage is ex: Geofile.index(filename, idxlist, new GeojsonParser()); => promise*/
    GeofileIndexer.index = function (idxlist, parsers) {
        if (idxlist === void 0) { idxlist = []; }
        // create the indexer and start parsing
        var indexer = new GeofileIndexer(idxlist, parsers);
        return indexer.parseAll();
    };
    GeofileIndexer.prototype.parseAll = function () {
        var _this = this;
        var start = Date.now();
        // check existence of mandatory files 
        return Promise.all(this.parsers.map(function (p) { return sync_1.FSFile.metadata(p.filename).catch(function () { return null; }); }))
            .then(function (metadatas) {
            if (metadatas.some(function (m) { return m === undefined || m === null; })) {
                throw new Error("missing mandatory file " + _this.parsers[metadatas.findIndex(function (m) { return m; })].filename);
            }
            _this.parsers.forEach(function (parser, i) { return parser.mdate = metadatas[i].modificationTime; });
            return sync_1.FSFile.metadata(_this.indexfilename);
        })
            .then(function (metadata) {
            if (metadata && _this.parsers.every(function (parser) { return parser.mdate < metadata.modificationTime; })) {
                console.log("geofile index file " + _this.indexfilename + " indexes up-to-date");
                return null;
            }
            else {
                // loop on each file to parse
                return _this.stream().then(function (_) {
                    // all files parsed then collect data, build and write index
                    _this.data = _this.parsers[0].collection;
                    _this.count = _this.parsers[0].collection.length;
                    if (_this.parsers[1]) {
                        _this.data.forEach(function (pitem, i) { return pitem.properties = _this.parsers[1].collection[i].properties; });
                    }
                    _this.buildIndex();
                    return _this.write().then(function (_) {
                        var time = Date.now() - start;
                        console.log("geofile index file " + _this.indexfilename + " wrote  (" + _this.count + " features / " + time + "ms)");
                    });
                });
            }
        });
    };
    /**
     * read the data from all the files to parse and write the data to the parsers
     * @param datafile datafile structure
     * @param i index in filelist of the datafile
     */
    GeofileIndexer.prototype.stream = function (i) {
        var _this = this;
        if (i === void 0) { i = 0; }
        if (i < this.parsers.length) {
            var parser_1 = this.parsers[i];
            return sync_1.FSFile.stream(parser_1.filename, sync_1.FSFormat.arraybuffer, function (data) { parser_1.onData(data); })
                .then(function () { return _this.stream(++i); });
        }
        ;
        return Promise.resolve();
    };
    GeofileIndexer.prototype.buildIndex = function () {
        this.buildHeader();
        this.buildHandles();
        this.builRtree();
        this.buildAttributes();
        this.buildMetadata();
    };
    GeofileIndexer.prototype.buildHeader = function () {
        this.header = new ArrayBuffer(this.HEADER_TSIZE);
        var dv = new DataView(this.header);
        this.HEADER_TAG.split('').forEach(function (c, i) { return dv.setUint8(i, c.charCodeAt(0)); });
        dv.setUint32(this.HEADER_TAG.length, this.count);
        dv.setUint32(this.HEADER_TAG.length + 4, this.idxlist.length + 2);
    };
    GeofileIndexer.prototype.buildHandles = function () {
        var _this = this;
        if (!this.data) {
            return;
        }
        this.handles = new DataView(new ArrayBuffer(this.HANDLES_RSIZE * this.count));
        this.clusters = [];
        this.data.forEach(function (f) {
            var offset = _this.HANDLES_RSIZE * f.rank;
            _this.handles.setUint32(offset, f.pos);
            _this.handles.setUint32(offset + 4, f.len);
            // minitile values will calculated at indexGeometry (default to full tile)
            _this.handles.setUint8(offset + 8, 0x00);
            _this.handles.setUint8(offset + 9, 0xFF);
        });
        var metadata = {
            attribute: 'rank',
            type: 'handle',
            buffer: this.handles.buffer,
            offset: this.INDEX_NEXT_OFFSET,
            length: this.handles.byteLength
        };
        this.indexes.push(metadata);
        console.log("geojson handles    " + this.indexfilename + " indexed / handles");
    };
    GeofileIndexer.prototype.bboxextend = function (bounds, bbox) {
        if (bbox) {
            if (bounds[0] == null || bbox[0] < bounds[0]) {
                bounds[0] = bbox[0];
            }
            if (bounds[1] == null || bbox[1] < bounds[1]) {
                bounds[1] = bbox[1];
            }
            if (bounds[2] == null || bbox[2] > bounds[2]) {
                bounds[2] = bbox[2];
            }
            if (bounds[3] == null || bbox[3] > bounds[3]) {
                bounds[3] = bbox[3];
            }
        }
        bounds[5]++;
    };
    GeofileIndexer.prototype.builRtree = function () {
        for (var i = 0; i < this.count; i += this.RTREE_CLUSTER_SIZE) {
            var bounds = [null, null, null, null, i, 0];
            for (var j = i; j < i + this.RTREE_CLUSTER_SIZE && j < this.count; j++) {
                var feature = this.data[j];
                var bbox = feature.bbox;
                this.bboxextend(bounds, bbox);
            }
            // check if some bounds is null
            if (!bounds.some(function (val) { return val === null; })) {
                this.setMinitile(bounds);
                this.clusters.push(bounds);
            }
        }
        var tree = new binrbush_1.binrbush();
        tree.load(this.clusters);
        var buffer = tree.toBinary();
        var metadata = {
            attribute: 'geometry',
            type: 'rtree',
            buffer: buffer,
            offset: this.INDEX_NEXT_OFFSET,
            length: buffer.byteLength
        };
        this.indexes.push(metadata);
        console.log("geojson rtree      " + this.indexfilename + " indexed / geometry");
    };
    GeofileIndexer.prototype.setMinitile = function (cluster) {
        if (!this.handles) {
            return;
        }
        var wtile = Math.abs(cluster[2] - cluster[0]) / 16;
        var htile = Math.abs(cluster[3] - cluster[1]) / 16;
        var xmin, ymin, xmax, ymax, pos, tmin, tmax, feature, bbox;
        var from = cluster[4];
        var to = cluster[4] + cluster[5];
        for (var rank = from; rank < to; rank++) {
            feature = this.data[rank];
            bbox = feature.bbox;
            if (bbox) {
                xmin = Math.floor(Math.abs(bbox[0] - cluster[0]) / wtile);
                xmax = Math.floor(Math.abs(bbox[2] - cluster[0]) / wtile);
                ymin = Math.floor(Math.abs(bbox[1] - cluster[1]) / htile);
                ymax = Math.floor(Math.abs(bbox[3] - cluster[1]) / htile);
                if (wtile === 0 || isNaN(xmax) || xmax > 15) {
                    xmax = 15;
                }
                if (htile === 0 || ymax > 15) {
                    ymax = 15;
                }
                if (wtile === 0 || isNaN(xmin)) {
                    xmin = 0;
                }
                if (htile === 0 || isNaN(ymin)) {
                    ymin = 0;
                }
                if (xmin > 15) {
                    xmin = 15;
                }
                if (ymin > 15) {
                    ymin = 15;
                }
                // tslint:disable-next-line:no-bitwise
                tmin = (xmin << 4) + ymin;
                // tslint:disable-next-line:no-bitwise
                tmax = (xmax << 4) + ymax;
                pos = rank * this.HANDLES_RSIZE;
                this.handles.setUint8(pos + 8, tmin);
                this.handles.setUint8(pos + 9, tmax);
            }
        }
    };
    GeofileIndexer.prototype.buildMetadata = function () {
        var _this = this;
        // attribute: 50 bytes (string) name of the indexed attribute ('rank' for handle and 'geometry' for geometry)
        // type: 10 bytes (string) index type (handle,rtree,ordered,fuzzy)
        // buffer: 4 bytes (uint32) offset du debut du buffer de l'index
        // length: 4 bytes (uint32) longueur du buffer de l'index
        var ATTR_OFFSET = 0;
        var TYPE_OFFSET = 50;
        var OFFS_OFFSET = 60;
        var LEN_OFFSET = 64;
        this.metadata = new ArrayBuffer(this.METADAS_RSIZE * this.indexes.length);
        var dv = new DataView(this.metadata);
        var offset = 0;
        this.indexes.forEach(function (index, i) {
            for (var c = 0; c < _this.METADAS_RSIZE; c++) {
                dv.setUint8(offset + c, 0);
            }
            index.attribute.split('').forEach(function (vcar, icar) { return dv.setUint8(offset + ATTR_OFFSET + icar, vcar.charCodeAt(0)); });
            index.type.split('').forEach(function (vcar, icar) { return dv.setUint8(offset + TYPE_OFFSET + icar, vcar.charCodeAt(0)); });
            dv.setUint32(offset + OFFS_OFFSET, index.offset);
            dv.setUint32(offset + LEN_OFFSET, index.length);
            offset += _this.METADAS_RSIZE;
        });
    };
    GeofileIndexer.prototype.buildAttributes = function () {
        // Creation des index Attributs
        for (var i = 0; i < this.idxlist.length; i++) {
            var attr = this.idxlist[i].attribute;
            var type = this.idxlist[i].type;
            switch (type) {
                case 'ordered':
                    this.buildOrderedIndex(attr);
                    break;
                case 'fuzzy':
                    this.buildFuzzyIndex(attr);
                    break;
                case 'prefix':
                    this.buildPrefixIndex(attr);
                    break;
                case 'rtree':
                case 'handle':
                    break;
                default: throw new Error("geofile index file " + this.indexfilename + " undefined index type  \"" + type + "\" for attribute \"" + attr + "\"");
            }
        }
    };
    GeofileIndexer.prototype.buildOrderedIndex = function (attr) {
        var attlist = [];
        for (var i = 0; i < this.count; i++) {
            var feature = this.data[i];
            var val = feature.properties[attr];
            attlist.push({ value: val, rank: i });
        }
        // on ordonne sur les valeurs de l'attribut
        attlist.sort(function (a, b) { return (a.value < b.value) ? -1 : (a.value > b.value) ? 1 : 0; });
        var buf = new ArrayBuffer(4 * attlist.length);
        var dv = new DataView(buf);
        attlist.forEach(function (att, i) {
            dv.setUint32(i * 4, att.rank);
            // console.log(`${att.rank} ==> ${att.value}`)
        });
        var metadata = {
            attribute: attr,
            type: 'ordered',
            buffer: buf,
            offset: this.INDEX_NEXT_OFFSET,
            length: buf.byteLength
        };
        console.log("geojson ordered    " + this.indexfilename + " indexed / " + attr);
        this.indexes.push(metadata);
    };
    GeofileIndexer.prototype.buildFuzzyIndex = function (attr) {
        var attlist = [];
        for (var i = 0; i < this.count; i++) {
            var feature = this.data[i];
            var val = feature.properties[attr];
            var hash = val ? val.fuzzyhash() : 0;
            attlist.push({ hash: hash, rank: i });
        }
        // we sort on fuzzyhash value
        attlist.sort(function (a, b) { return (a.hash < b.hash) ? -1 : (a.hash > b.hash) ? 1 : 0; });
        var buf = new ArrayBuffer(4 * attlist.length);
        var dv = new DataView(buf);
        attlist.forEach(function (att, i) { return dv.setUint32(i * 4, att.rank); });
        var metadata = {
            attribute: attr,
            type: 'fuzzy',
            buffer: buf,
            offset: this.INDEX_NEXT_OFFSET,
            length: buf.byteLength
        };
        this.indexes.push(metadata);
        console.log("geojson fuzzy      " + this.indexfilename + " indexed / " + attr);
    };
    GeofileIndexer.prototype.buildPrefixIndex = function (attr) {
        // collecting prefix tuples
        var preflist = [];
        var _loop_1 = function (i) {
            var feature = this_1.data[i];
            var val = feature.properties[attr];
            var wlist = val ? (val + '').wordlist() : [];
            // console.log(val); console.log(wlist);
            wlist.forEach(function (w) { return preflist.push({ value: w.substring(0, 4), rank: i }); });
        };
        var this_1 = this;
        for (var i = 0; i < this.count; i++) {
            _loop_1(i);
        }
        // we sort on prefix
        preflist.sort(function (a, b) { return (a.value < b.value) ? -1 : (a.value > b.value) ? 1 : (a.rank - b.rank); });
        var buf = new ArrayBuffer(8 * preflist.length);
        var dv = new DataView(buf);
        preflist.forEach(function (att, i) {
            [32, 32, 32, 32].forEach(function (c, idx) { return dv.setUint8(i * 8 + idx, c); }); // white padding
            att.value.split('').forEach(function (c, idx) { return dv.setUint8(i * 8 + idx, c.charCodeAt(0)); });
            dv.setUint32(i * 8 + 4, att.rank);
        });
        var metadata = {
            attribute: attr,
            type: 'prefix',
            buffer: buf,
            offset: this.INDEX_NEXT_OFFSET,
            length: buf.byteLength
        };
        this.indexes.push(metadata);
        console.log("geojson prefix     " + this.indexfilename + " indexed / " + attr);
    };
    GeofileIndexer.prototype.write = function () {
        var total = this.header.byteLength + this.metadata.byteLength + this.indexes.reduce(function (p, c) { return p + c.buffer.byteLength; }, 0);
        var buf = new ArrayBuffer(total);
        var target = new Uint8Array(buf);
        var offset = 0;
        // copying data in one buffer 
        (new Uint8Array(this.header)).forEach(function (val, i) { return target[offset++] = val; });
        (new Uint8Array(this.metadata)).forEach(function (val, i) { return target[offset++] = val; });
        ;
        this.indexes.forEach(function (index) {
            (new Uint8Array(index.buffer)).forEach(function (val, i) { return target[offset++] = val; });
        });
        return sync_1.FSFile.write(this.indexfilename, buf);
    };
    return GeofileIndexer;
}());
exports.GeofileIndexer = GeofileIndexer;
//# sourceMappingURL=geofile.js.map