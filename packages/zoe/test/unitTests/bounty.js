import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';
import { assert, details as X } from '@agoric/assert';

/**
 * This contract lets a funder endow a bounty that will pay out if an Oracle
 * reports an event at a deadline. To make a simple contract for a test the
 * contract only pays attention to the event that occurs at the requested
 * deadline. A realistic contract might look more than once, or might accept any
 * positive response before the deadline.
 *
 * @type {ContractStartFn}
 */
import { assertProposalShape } from '../../src/contractSupport';

const start = async zcf => {
  const { oracle, deadline, condition, timer, fee } = zcf.getTerms();
  const {
    maths: { Fee: feeMath, Bounty: bountyMath },
  } = zcf.getTerms();

  /** @type {OfferHandler} */
  function funder(funderSeat) {
    const endowBounty = harden({
      give: { Bounty: null },
    });
    assertProposalShape(funderSeat, endowBounty);

    function payOffBounty(seat) {
      zcf.reallocate(
        funderSeat.stage({ Bounty: bountyMath.getEmpty() }),
        seat.stage({ Bounty: funderSeat.getCurrentAllocation().Bounty }),
      );
      seat.exit();
      funderSeat.exit();
      zcf.shutdown('bounty was paid');
    }

    function refundBounty(seat) {
      // funds are already allocated.
      seat.exit();
      funderSeat.exit();
      zcf.shutdown('The bounty was not earned');
    }

    /** @type {OfferHandler} */
    function beneficiary(bountySeat) {
      const feeProposal = harden({
        give: { Fee: null },
      });
      assertProposalShape(bountySeat, feeProposal);
      const feeAmount = bountySeat.getCurrentAllocation().Fee;
      assert(
        feeMath.isGTE(feeAmount, fee),
        X`Fee was required to be at least ${fee}`,
      );

      // The funder gets the fee regardless of the outcome.
      zcf.reallocate(
        funderSeat.stage({ Fee: feeAmount }),
        bountySeat.stage({ Fee: feeMath.getEmpty() }),
      );

      const wakeHandler = Far('wakeHandler', {
        wake: async () => {
          const reply = await E(oracle).query('state');
          if (reply.event === condition) {
            payOffBounty(bountySeat);
          } else {
            refundBounty(bountySeat);
          }
        },
      });
      timer.setWakeup(deadline, wakeHandler);
    }

    return zcf.makeInvitation(beneficiary, 'pay to be the beneficiary');
  }

  const creatorInvitation = zcf.makeInvitation(funder, 'fund a bounty');
  return harden({ creatorInvitation });
};

harden(start);
export { start };
