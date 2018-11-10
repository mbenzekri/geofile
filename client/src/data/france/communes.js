'use strict';

(function() {

    const  style_default = new ol.style.Style({
        stroke : new ol.style.Stroke({
            color: "#000000" ,
            width: 1
        })
    });
    const  style_lt_300000 = new ol.style.Style({
        stroke : new ol.style.Stroke({
            color: "#000000" ,
            width: 1
        }),
        text : new ol.style.Text({
            font: "16px Arial",
            textAlign : 'center',
            textBaseline : 'middle',
            stroke : new ol.style.Stroke({
                color: "#FF0000" ,
                width: 1
            }) 
        })
    });
    const style = function(feature,resolution) {
        var scale=feature.geofile.getScale(resolution,feature.proj);
        if (scale < 300000 ) {
            style_lt_300000.getText().setText(feature.get("NOM_COM").titlecase())
            return [style_lt_300000];
        }
        return [style_default];
    };
    return {
        name: 'Municipality',
        title: 'French municipalities',
        minscale: 20000,
        maxscale: 1500000,
        style: style
    }
}()) 