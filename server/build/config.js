"use strict";
// JavaScript Document
Object.defineProperty(exports, "__esModule", { value: true });
exports.conf = {
    indexes: {
        'communes.shp': [
            { attribute: 'INSEE_COM', type: 'ordered' },
            { attribute: 'NOM_COM', type: 'fuzzy' },
            { attribute: 'NOM_COM', type: 'prefix' }
        ],
        'world_a.geojson': [
            { attribute: 'NAME_FR', type: 'ordered' },
            { attribute: 'NAME_FR', type: 'fuzzy' },
            { attribute: 'NAME_FR', type: 'prefix' }
        ],
        'world_b.shp': [
            { attribute: 'NAME_FR', type: 'ordered' },
            { attribute: 'NAME_FR', type: 'fuzzy' },
            { attribute: 'NAME_FR', type: 'prefix' }
        ],
        'world_c.csv': [
            { attribute: 'NAME_FR', type: 'ordered' },
            { attribute: 'NAME_FR', type: 'fuzzy' },
            { attribute: 'NAME_FR', type: 'prefix' }
        ],
        'world.geojson': [
            { attribute: 'NAME_SORT', type: 'ordered' },
            { attribute: 'NAME_SORT', type: 'fuzzy' },
            { attribute: 'NAME_SORT', type: 'prefix' }
        ],
        'countries_lakes.shp': [
            { attribute: 'NAME_SORT', type: 'ordered' },
            { attribute: 'NAME_SORT', type: 'fuzzy' },
            { attribute: 'NAME_SORT', type: 'prefix' }
        ],
        'adresses_92.csv': [
            { attribute: 'adresse', type: 'prefix' },
            { attribute: 'nom_voie', type: 'fuzzy' },
            { attribute: 'id', type: 'ordered' }
        ]
    },
    // nothing to exclude today
    exclude: []
};
//# sourceMappingURL=config.js.map