import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { SkMapTestComponent } from './sk-map-test.component';

describe('SkMapTestComponent', () => {
  let component: SkMapTestComponent;
  let fixture: ComponentFixture<SkMapTestComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ SkMapTestComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(SkMapTestComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
