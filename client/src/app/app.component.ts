import { Component } from '@angular/core';

@Component({
  selector: 'sk-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  title = 'skrat';
  test = 'map'; // choose between sync, geojson, shapefile, csv and  map;
}
