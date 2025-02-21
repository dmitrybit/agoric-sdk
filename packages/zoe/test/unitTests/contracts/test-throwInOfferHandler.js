/* global __dirname */
// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/install-ses';
// eslint-disable-next-line import/no-extraneous-dependencies
import test from 'ava';

import bundleSource from '@agoric/bundle-source';

import { E } from '@agoric/eventual-send';
import { makeZoe } from '../../../src/zoeService/zoe';
import fakeVatAdmin from '../../../src/contractFacet/fakeVatAdmin';

const contractRoot = `${__dirname}/throwInOfferHandler`;

test('throw in offerHandler', async t => {
  const zoe = makeZoe(fakeVatAdmin);

  // pack the contract
  const bundle = await bundleSource(contractRoot);
  // install the contract
  const installation = await E(zoe).install(bundle);

  const { creatorFacet } = await E(zoe).startInstance(installation);

  const throwInOfferHandlerInvitation = E(
    creatorFacet,
  ).makeThrowInOfferHandlerInvitation();

  const throwInDepositToSeatInvitation = E(
    creatorFacet,
  ).makeThrowInDepositToSeatInvitation();

  const throwsInOfferHandlerSeat = E(zoe).offer(throwInOfferHandlerInvitation);

  const throwsInOfferHandlerResult = E(
    throwsInOfferHandlerSeat,
  ).getOfferResult();

  // Uncomment below to see what the user would see
  // await throwsInOfferHandlerResult;

  await t.throwsAsync(() => throwsInOfferHandlerResult, {
    message: 'error thrown in offerHandler in contract',
  });

  const throwsInDepositToSeatSeat = E(zoe).offer(
    throwInDepositToSeatInvitation,
  );

  const throwsInDepositToSeatResult = E(
    throwsInDepositToSeatSeat,
  ).getOfferResult();

  // Uncomment below to see what the user would see
  // await throwsInDepositToSeatResult;

  // TODO: make this logging more informative, including information
  // about the error originating in the offerHandler in depositToSeat

  // Currently the entirety of the log is:

  // "Rejected promise returned by test. Reason:
  // Error {
  //   message: '"brand" not found: (an object)',
  // }
  // › makeDetailedError (/Users/katesills/code/agoric-sdk/node_modules/ses/dist/ses.cjs:3437:17)
  // › fail (/Users/katesills/code/agoric-sdk/node_modules/ses/dist/ses.cjs:3582:19)
  // › baseAssert (/Users/katesills/code/agoric-sdk/node_modules/ses/dist/ses.cjs:3600:13)
  // › assertKeyExists (/Users/katesills/code/agoric-sdk/packages/store/src/weak-store.js:19:5)
  // › Object.get [as getByBrand] (/Users/katesills/code/agoric-sdk/packages/store/src/weak-store.js:27:7)
  // › getAmountMath (src/zoeService/zoe.js:44:46)
  // › src/cleanProposal.js:65:5
  // › Array.map (<anonymous>)
  // › coerceAmountKeywordRecord (src/cleanProposal.js:64:34)
  // › cleanProposal (src/cleanProposal.js:116:10)
  // › src/zoeService/zoe.js:408:28"

  await t.throwsAsync(() => throwsInDepositToSeatResult, {
    message: `"brand" not found: (an object)`,
  });
});
