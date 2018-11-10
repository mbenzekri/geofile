'use strict';

(function() {

    const fill = new ol.style.Fill({
        color: 'rgba(255,255,255,0.4)'
    });
    
    const stroke = new ol.style.Stroke({
        color: '#FF0000',
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

    return {
        name: 'Adresses',
        title: 'Departement 92 adresses',
        minscale: 0,
        maxscale: 20000,
        style: DEFAULT_STYLE,
        parser: {
            header: ['id', 'adresse', 'nom_voie', 'numero', 'rep', 'code_insee', 'code_post', 'nom_ld', 'x', 'y', 'lon', 'lat', 'nom_commune'],
            separator: ';'
        }
    }
}()) 