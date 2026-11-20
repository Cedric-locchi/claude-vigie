import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { FIND_MAX } from './code-editor';
import { CodeEditorVm } from './code-editor.vm';

function setup(content = 'un\r\ndeux un\r\nUN trois') {
  TestBed.configureTestingModule({ providers: [CodeEditorVm] });
  const vm = TestBed.inject(CodeEditorVm);
  const text = signal(content);
  vm.connect(text);
  return { vm, text };
}

describe('CodeEditorVm', () => {
  it('fermée : rien de cherché ; ouverte avec la sélection pour terme, résultat courant = le premier après le curseur', () => {
    const { vm } = setup();
    vm.query.set('un');
    expect(vm.matches()).toEqual([]);
    // Texte en LF, comme la textarea : « un\ndeux un\nUN trois ».
    vm.start('un', 4);
    expect(vm.open()).toBe(true);
    expect(vm.matches()).toEqual([{ from: 0, to: 2 }, { from: 8, to: 10 }, { from: 11, to: 13 }]);
    expect(vm.current()).toBe(1);
    expect(vm.count()).toEqual({ text: '2/3', label: 'Résultat 2 sur 3' });
    expect(vm.parts().map((p) => p.text).join('')).toBe('un\ndeux un\nUN trois');
    expect(vm.parts().filter((p) => p.cur)).toEqual([{ text: 'un', hit: true, cur: true }]);
  });

  it('suivant et précédent circulaires ; chaque déplacement demande le défilement', () => {
    const { vm } = setup();
    vm.start('un', 0);
    const moved = vm.moved();
    expect(vm.current()).toBe(0);
    vm.prev();
    expect(vm.current()).toBe(2);
    vm.next();
    vm.next();
    expect(vm.current()).toBe(1);
    expect(vm.moved()).toBe(moved + 3);
  });

  it('saisie et casse : le courant repart du dernier résultat montré ; aucun résultat ; graine vide = saisie gardée', () => {
    const { vm } = setup();
    vm.start('un', 0);
    vm.next(); // « un » de la ligne 2
    vm.toggleCase();
    expect(vm.matches()).toHaveLength(2);
    expect(vm.current()).toBe(1);
    vm.setQuery('zz');
    expect([vm.current(), vm.count()]).toEqual([-1, { text: 'Aucun résultat', label: 'Aucun résultat' }]);
    vm.next(); // sans résultat : rien
    expect(vm.current()).toBe(-1);
    vm.setQuery('');
    expect(vm.count()).toBeNull();
    vm.setQuery('trois');
    vm.close();
    vm.start('', 0);
    expect(vm.query()).toBe('trois');
  });

  it('une frappe dans le code borne le résultat courant sans le remettre au premier', () => {
    const { vm, text } = setup('a a a a');
    vm.start('a', 4);
    expect(vm.current()).toBe(2);
    const moved = vm.moved();
    text.set('a a a a b');
    expect(vm.current()).toBe(2);
    text.set('a a');
    expect(vm.current()).toBe(1);
    expect(vm.moved()).toBe(moved); // pas de défilement pendant la frappe
  });

  it('fermer rend le résultat courant (à sélectionner dans le code), null sans résultat', () => {
    const { vm } = setup();
    vm.start('deux', 0);
    expect(vm.close()).toEqual({ from: 3, to: 7 });
    expect([vm.open(), vm.matches(), vm.parts()]).toEqual([false, [], []]);
    vm.start('zz', 0);
    expect(vm.close()).toBeNull();
  });

  it('au-delà du plafond : « 1000+ »', () => {
    const { vm } = setup('x'.repeat(FIND_MAX + 1));
    vm.start('x', 0);
    expect(vm.count()).toEqual({ text: `1/${FIND_MAX}+`, label: `Résultat 1 sur plus de ${FIND_MAX}` });
  });
});
