import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentityGate,createRequestRegistry,isAmbiguous,responseIsAmbiguous} from '../src/services/operationState.ts';

test('late Alice completion cannot update Bob state',async()=>{
 const gate=createIdentityGate('alice');const ticket=gate.capture();let finish;let profile=null;
 const pending=new Promise(resolve=>{finish=resolve}).then(value=>{if(gate.current(ticket))profile=value});
 gate.transition(null);gate.transition('bob');finish({id:'alice',credits:42});await pending;
 assert.equal(profile,null);assert.equal(gate.current(gate.capture()),true);
});
test('logout and login to the same UID still invalidate old operations',()=>{
 const gate=createIdentityGate('alice');const before=gate.capture();gate.transition(null);gate.transition('alice');assert.equal(gate.current(before),false);
});
test('immediate invalidation protects pending work before auth callback',()=>{
 const gate=createIdentityGate('alice');const before=gate.capture();gate.invalidate();assert.equal(gate.current(before),false);
});
test('unchanged identity does not discard current work',()=>{
 const gate=createIdentityGate('alice');const before=gate.capture();gate.transition('alice');assert.equal(gate.current(before),true);
});
test('parse retry retains ID only for exact payload until confirmed completion',()=>{
 const registry=createRequestRegistry();const first=registry.get('Pasta — basil');assert.equal(registry.get('Pasta — basil'),first);assert.notEqual(registry.get('Pasta — mint'),first);registry.complete('Pasta — basil');assert.notEqual(registry.get('Pasta — basil'),first);
});
test('checkout retry is package-scoped and identity reset discards it',()=>{
 const registry=createRequestRegistry();const first=registry.get('starter');assert.equal(registry.get('starter'),first);assert.notEqual(registry.get('large'),first);registry.clear();assert.notEqual(registry.get('starter'),first);
});
test('ambiguity recognition retains network/server uncertainties',()=>{
 assert.equal(isAmbiguous(Object.assign(new Error('network'),{ambiguous:true})),true);assert.equal(isAmbiguous(new Error('known validation failure')),false);assert.equal(isAmbiguous(null),false);
});

test('pending parse response is nonterminal, previous failure is terminal',()=>{
 assert.equal(responseIsAmbiguous(409,'PARSE_PENDING'),true);
 assert.equal(responseIsAmbiguous(409,'PARSE_FAILED_PREVIOUSLY'),false);
 assert.equal(responseIsAmbiguous(502,'PARSE_FAILED'),false);
 assert.equal(responseIsAmbiguous(502,'GENERATION_FAILED'),false);
 assert.equal(responseIsAmbiguous(503,'UNCONFIRMED'),true);
});
