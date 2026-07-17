import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NewConversation } from './new-conversation';

describe('NewConversation', () => {
  let component: NewConversation;
  let fixture: ComponentFixture<NewConversation>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewConversation],
    }).compileComponents();

    fixture = TestBed.createComponent(NewConversation);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
