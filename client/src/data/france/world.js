'use strict';

(function() {

    const  style_default = new ol.style.Style({
        stroke : new ol.style.Stroke({
            color: "#00C58A" ,
            width: 2
        })
    });
    
    const style_ge_200000 = new ol.style.Style({
        stroke : new ol.style.Stroke({
            color: "#00C58A" ,
            width: 2
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
    
    // Ceci est un commentaire accentués éêûïèçùÀÙÌ
    const style = function(feature,resolution) {
        var scale=feature.geofile.getScale(resolution,feature.proj);
        if (scale >= 200000 ) {
            style_ge_200000.getText().setText(feature.get("NAME_FR"))
            return [style_ge_200000];
        }
        return [style_default];
    };
    return {
        name: 'Country',
        title: 'World countries',
        minscale: 1000000,
        maxscale: 10000000000,
        style: style
    }
}()) 