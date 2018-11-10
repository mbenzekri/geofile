/* Copyright (c) 2014 by Ondeo Systems */

var Feature = function (gid,shp,gpos,apos) 
{
    this.gid=gid;
    this.shapefile=shp;
    this.geompos=gpos;
    this.attrpos=apos;
}

Feature.prototype.getTypeCode = function() {
    return this.shapefile.gdv.getInt32(this.geompos,true);
}

Feature.prototype.getType = function() {
    return Feature.CodeToType[this.getTypeCode()];
}

Feature.prototype.getBbox = function() {
    var fxmin=this.shapefile.gdv.getFloat64(this.geompos+4,true);
    var fymin=this.shapefile.gdv.getFloat64(this.geompos+12,true);
    var fxmax=fxmin;
    var fymax=fymin;
    var type=this.getTypeCode();
    if(type != Feature.TypeToCode.Point && type != Feature.TypeToCode.PointZ && type != Feature.TypeToCode.PointM) {
        var fxmax=this.shapefile.gdv.getFloat64(this.geompos+20,true);
        var fymax=this.shapefile.gdv.getFloat64(this.geompos+28,true);
    }
    return [fxmin,fymin,fxmax,fymax];
}

Feature.prototype.bboxInteract= function(xmin,ymin,xmax,ymax) {
    var bbox = this.getBbox();
    var fxmin=bbox[0];
    var fymin=bbox[1];
    var fxmax=bbox[2];
    var fymax=bbox[3];
    if (fxmin < xmin && fxmax < xmin ) return false;
    if (fxmin > xmax && fxmax > xmax ) return false;    
    if (fymin < ymin && fymax < ymin ) return false;
    if (fymin > ymax && fymax > ymax ) return false;
    return true;
}

Feature.TypeToCode = {
    NullShape       : 0,
    Point           : 1,
    PolyLine        : 3,
    Polygon         : 5,
    MultiPoint      : 8,
    PointZ          : 11,
    PolyLineZ       : 13, 
    PolygonZ        : 15, 
    MultiPointZ     : 18, 
    PointM          : 21, 
    PolyLineM       : 23, 
    PolygonM        : 25, 
    MultiPointM     : 28, 
    MultiPatch      : 31
};

Feature.CodeToType = {};
for(var key in Feature.TypeToCode) 
{
   Feature.CodeToType[Feature.TypeToCode[key]]=key;
}

Feature.prototype.pointInteract= function(x,y) {

    var fxmin=this.shapefile.gdv.getFloat64(this.geompos+4,true);
    var fxmax=this.shapefile.gdv.getFloat64(this.geompos+20,true);
    if (x < fxmin || x > fxmax) return false;
    
    var fymin=this.shapefile.gdv.getFloat64(this.geompos+12,true);
    var fymax=this.shapefile.gdv.getFloat64(this.geompos+28,true);
    if (y < fymin || y > fymax ) return false;

    return true;
}

// nombre d'anneau exterieur et interieur
Feature.prototype.ringCount = function() {
    return this.shapefile.gdv.getInt32(this.geompos+36,true);
}

// nombre total de point 
Feature.prototype.pointCount = function() {
    return this.shapefile.gdv.getInt32(this.geompos+40,true);
}

// position du tableau d'index des anneaux
Feature.prototype.ringIndex = function() {
  return this.geompos+44;
}

// position du 1er point de tous les anneaux
Feature.prototype.pointStart = function() {
  return this.ringIndex()+4*this.ringCount();
}

// offset du 1er point d'un anneau a partir de pointStart()
Feature.prototype.ringPointOffset = function(i) {
    return 16*this.shapefile.gdv.getInt32(this.ringIndex()+i*4,true);
}

// position du premier point d'un anneau
Feature.prototype.ringPointStart = function(i) {
  return this.pointStart()+this.ringPointOffset(i);
}
// nombre de points d'un anneau
Feature.prototype.ringPointCount = function(i) {
  var deb=this.ringPointOffset(i);
  var fin=(i+1 < this.ringCount()) ? this.ringPointOffset(i+1) : 16*this.pointCount();
  return Math.floor((fin-deb)/16);
}

Feature.prototype.xPoint = function(ring,i) {
  var pos=this.ringPointStart(ring)+i*16;
  return this.shapefile.gdv.getFloat64(pos,true);
}

Feature.prototype.yPoint = function(ring,i) {
  var pos=this.ringPointStart(ring)+i*16;
  return this.shapefile.gdv.getFloat64(pos+8,true);
}

Feature.prototype.toString = function() {
  return "rings="+this.ringCount()+"points="+this.pointCount()+"points0="+this.ringPointCount(0);
}

Feature.prototype.getValue = function(attr) {
  var desc=this.shapefile.dbfheader.fields[attr];
  if (!desc) return null;
  var sdv=new Uint8Array(this.shapefile.attrData,this.attrpos+desc.offset,desc.len);
  var txt=textdecoder(sdv,0,desc.len);
  if (desc.type==="C") return txt;
  if (desc.type==="N" && desc.decimal===0) return parseInt(txt,10);
  if (desc.type==="N" || desc.type==="F" || desc.type==="Y") return parseFloat(txt);
  if (desc.type==="L") return txt;
  // D => YYYYMMDD
  return txt;
}

Feature.prototype.getAttributes = function() {
    //return {};
    var flds=this.shapefile.getFields();
    if (! flds) return null;
    var attributes={};
    for(var attr in flds) {
        var desc=flds[attr];
        var sdv=new Uint8Array(this.shapefile.attrData,this.attrpos+desc.offset,desc.len);
        var txt=textdecoder(sdv,0,desc.len);
        if (desc.type==="C") {
            attributes[attr]=txt;
        } else if (desc.type==="N" && desc.decimal===0) {
            attributes[attr]=parseInt(txt,10);
        } else if (desc.type==="N" || desc.type==="F" || desc.type==="Y") {
            attributes[attr]=parseFloat(txt);
        } else if (desc.type==="L") {
            attributes[attr]=txt;
        }
        // Manque le type Date ?? D => YYYYMMDD
    }
    return attributes;
}
Feature.prototype.getGeometry = function() {
    var type=this.getType();
    var reader=this.geometryReader[type];

    if (!reader) return null;
    return reader.call(this,this.shapefile.gdv,this.geompos);
}

Feature.prototype.getFeature = function() {
      var feature, geometry, attributes, bbox;
      geometry = this.getGeometry();
      if (geometry) geometry.bounds = OpenLayers.Bounds.fromArray(this.getBbox());
      attributes = this.getAttributes();
      feature = new OpenLayers.Feature.Vector(geometry, attributes);
      feature.fid = this.shapefile.name+"."+this.gid;
      return feature;
};

var _getbbox=function(dv,pos){
    return [dv.getFloat64(pos,true),dv.getFloat64(pos+8,true),dv.getFloat64(pos+16,true),dv.getFloat64(pos+24,true)];
};

Feature.prototype.geometryReader = {
    //  Type Null
    //  Position    Field       Value   Type    Number  Byte Order
    //  Byte 0      Shape Type  0       Integer 1       Little
    NullShape       : function(gdv,pos) { return null;},

    //  Type Point
    //  Position    Field       Value   Type    Number  Byte Order
    //  Byte 0      Shape Type  1       Integer 1       Little
    //  Byte 4      X           X       Double  1       Little
    //  Byte 12     Y           Y       Double  1       Little
    Point           : function(gdv,pos) {
        var type=gdv.getInt32(pos,true);
        if (type != 1) return null;
        var x=gdv.getFloat64(pos+4,true);
        var y=gdv.getFloat64(pos+12,true);
        return new OpenLayers.Geometry.Point(x,y);
    },
    //  Type Polyline
    //  Position    Field       Value       Type    Number      Byte Order
    //  Byte 0      Shape Type  3           Integer 1           Little
    //  Byte 4      Box         Box         Double  4           Little
    //  Byte 36     NumParts    NumParts    Integer 1           Little
    //  Byte 40     NumPoints   NumPoints   Integer 1           Little
    //  Byte 44     Parts       Parts       Integer NumParts    Little
    //  Byte X      Points      Points      Point   NumPoints   Little
    //
    //  Note: X = 44 + 4 * NumParts
    PolyLine        : function(gdv,pos) 
    {
        var type=gdv.getInt32(pos,true);
        if (type != 3) return null;
        var bbox=_getbbox(gdv,pos+4);
        var numparts=gdv.getInt32(pos+36,true);
        var numpoints=gdv.getInt32(pos+40,true);
        var parts=[];
        var line=[];
        var ppos=pos+44;
        for (var part=0;part<numparts;part++) {
            parts.push(gdv.getInt32(ppos+(part*4),true));
        };
        var ppos=pos+44+(4*numparts);
        while (parts.length > 0) {
            var deb=2*8*parts.shift();
            var fin=2*8*((parts.length > 0) ? parts[0] : numpoints);
            for (var i=deb;i<fin;i+=16) {
                var x=gdv.getFloat64(ppos+i,true);
                var y=gdv.getFloat64(ppos+i+8,true);
                line.push(new OpenLayers.Geometry.Point(x,y))
            };
        }
        return new OpenLayers.Geometry.LineString(line);
    },
    //  Type Polygon
    //  Position    Field       Value       Type    Number      Byte Order
    //  Byte 0      Shape Type  5           Integer 1           Little
    //  Byte 4      Box         Box         Double  4           Little
    //  Byte 36     NumParts    NumParts    Integer 1           Little
    //  Byte 40     NumPoints   NumPoints   Integer 1           Little
    //  Byte 44     Parts       Parts       Integer NumParts    Little
    //  Byte X      Points      Points      Point   NumPoints   Little
    //
    //  Note: X = 44 + 4 * NumParts
    Polygon         : function(gdv,pos) 
    {
        var type=gdv.getInt32(pos,true);
        if (type != 5) return null;
        var polygon = new OpenLayers.Geometry.MultiPolygon();
        var bbox=_getbbox(gdv,pos+4);
        var numparts=gdv.getInt32(pos+36,true);
        var numpoints=gdv.getInt32(pos+40,true);
        var parts=[];
        var ppos=pos+44;
        for (var part=0;part<numparts;part++) {
            parts.push(gdv.getInt32(ppos+(part*4),true));
        };
        var ppos=pos+44+(4*numparts);
        var max=(2*8*numpoints);
        while (parts.length > 0) {
            var line=[];
            var deb=2*8*parts.shift();
            var fin=2*8*((parts.length > 0) ? parts[0] : numpoints);
            for (var i=deb;i<fin;i+=16) {
                var x=gdv.getFloat64(ppos+i,true);
                var y=gdv.getFloat64(ppos+i+8,true);
                line.push(new OpenLayers.Geometry.Point(x,y))
            };
            line.push(line[0]);
            var lring= new OpenLayers.Geometry.LinearRing(line);
            var psimple=new OpenLayers.Geometry.Polygon();
            psimple.addComponent(lring);
            polygon.addComponent(psimple);
        }
        return polygon;
    },
    //  Type Point
    //  Position    Field       Value       Type        Number      Byte Order
    //  Byte 0      Shape Type  8           Integer     1           Little
    //  Byte 4      Box         Box         Double      4           Little
    //  Byte 36     NumPoints   NumPoints   Integer     1           Little
    //  Byte 40     Points      Points      Point       NumPoints   Little
    MultiPoint      : function(gdv,pos) 
    {
        var type=gdv.getInt32(pos,true);
        if (type != 8) return null;
        var bbox=_getbbox(gdv,pos+4);
        var numpoints=gdv.getInt32(pos+36,true);
        var points = [];
        var ipos=pos+40;
        for (var i=0;i<numpoints;i++) {
            var x=gdv.getFloat64(ipos,true);
            var y=gdv.getFloat64(ipos+8,true);
            points.push(new OpenLayers.Geometry.Point(x, y))
            ipos+=16;
        }
        return new OpenLayers.Geometry.Point(points[0]);
    },
    PointZ          : function(data,pos) { return null;},
    PolyLineZ       : function(data,pos) { return null;}, 
    PolygonZ        : function(data,pos) { return null;}, 
    MultiPointZ     : function(data,pos) { return null;}, 
    PointM          : function(data,pos) { return null;}, 
    PolyLineM       : function(data,pos) { return null;}, 
    PolygonM        : function(data,pos) { return null;}, 
    MultiPointM     : function(data,pos) { return null;}, 
    MultiPatch      : function(data,pos) { return null;}
};


