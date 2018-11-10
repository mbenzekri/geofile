import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AppComponent } from './app.component';
import { TestSyncComponent } from './test/test-sync.component';
import { TestGeojsonComponent } from './test/test-geojson.component';
import { TestShapefileComponent } from './test/test-shapefile.component';
import { TestCsvComponent } from './test/test-csv.component';
import { SkMapTestComponent } from './sk-map-test/sk-map-test.component';
import { TestBaseComponent } from './test/test-base.component';

@NgModule({
  declarations: [
    AppComponent,
    TestSyncComponent,
    TestGeojsonComponent,
    TestShapefileComponent,
    TestCsvComponent,
    SkMapTestComponent,
    TestBaseComponent
  ],
  imports: [
    FormsModule,
    BrowserModule
  ],
  providers: [],
  bootstrap: [AppComponent],
  exports: [
    TestSyncComponent,
    TestGeojsonComponent,
    TestShapefileComponent,
    TestCsvComponent]
})
export class AppModule { }
