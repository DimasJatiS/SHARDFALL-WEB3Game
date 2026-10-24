// Tests from PRD v2 §4.3: rejections, payouts for 10 and 3 players, refund timing.
import assert from "node:assert/strict";
import hre from "hardhat";
import { keccak256, parseEther, toHex, type Address } from "viem";

const FEE = parseEther("0.1");
const seed = keccak256(toHex("shardfall-test-seed"));
const seedHash = keccak256(seed);
const matchId = keccak256(toHex("match-1"));

async function setup() {
  const wallets = await hre.viem.getWalletClients();
  const [owner, operator, treasury, ...players] = wallets;
  const escrow = await hre.viem.deployContract("MatchEscrow", [operator.account.address, treasury.account.address]);
  const pub = await hre.viem.getPublicClient();
  const asOp = await hre.viem.getContractAt("MatchEscrow", escrow.address, { client: { wallet: operator } });
  const as = (i: number) => hre.viem.getContractAt("MatchEscrow", escrow.address, { client: { wallet: players[i] } });
  await asOp.write.createMatch([matchId, FEE, 10, seedHash]);
  // join(n): make sure players 0..n-1 have joined (continues from previous calls).
  let joined = 0;
  const join = async (n: number) => {
    for (; joined < n; joined++) await (await as(joined)).write.joinMatch([matchId], { value: FEE });
  };
  const addr = (i: number) => players[i].account.address as Address;
  return { owner, operator, treasury, players, escrow, pub, asOp, as, join, addr };
}

async function increaseTime(secs: number) {
  await hre.network.provider.send("evm_increaseTime", [secs]);
  await hre.network.provider.send("evm_mine");
}

async function rejects(p: Promise<unknown>, error: string) {
  await assert.rejects(p, (e: Error) => e.message.includes(error), `expected ${error}`);
}

describe("MatchEscrow", () => {
  it("rejects wrong fee, double join and a full match", async () => {
    const { as, join } = await setup();
    await rejects((await as(0)).write.joinMatch([matchId], { value: FEE - 1n }), "WrongFee");
    await join(1);
    await rejects((await as(0)).write.joinMatch([matchId], { value: FEE }), "AlreadyJoined");
  }).timeout(60000);

  it("rejects joining when the match is full", async () => {
    const { as, join } = await setup();
    await join(10);
    await rejects((await as(10)).write.joinMatch([matchId], { value: FEE }), "MatchFull");
  }).timeout(60000);

  it("rejects settle with wrong seed, from a non-operator, or with < 3 players", async () => {
    const { asOp, as, join, addr } = await setup();
    await join(2);
    const top3 = [addr(0), addr(1), addr(2)] as const;
    await rejects(asOp.write.settleMatch([matchId, top3, seed]), "NotEnoughPlayers");
    await join(3);
    await rejects(asOp.write.settleMatch([matchId, top3, keccak256(toHex("wrong"))]), "BadSeed");
    await rejects((await as(0)).write.settleMatch([matchId, top3, seed]), "NotOperator");
    await rejects(asOp.write.settleMatch([matchId, [addr(0), addr(0), addr(1)], seed]), "BadWinners");
    await rejects(asOp.write.settleMatch([matchId, [addr(0), addr(1), addr(8)], seed]), "BadWinners");
  }).timeout(60000);

  for (const n of [10, 3]) {
    it(`pays the top 3 correctly with ${n} players`, async () => {
      const { asOp, join, addr, pub, treasury, escrow } = await setup();
      await join(n);
      const before = await Promise.all([addr(0), addr(1), addr(2), treasury.account.address].map((a) => pub.getBalance({ address: a })));
      await asOp.write.settleMatch([matchId, [addr(0), addr(1), addr(2)], seed]);
      const after = await Promise.all([addr(0), addr(1), addr(2), treasury.account.address].map((a) => pub.getBalance({ address: a })));
      const pool = FEE * BigInt(n);
      const net = pool - (pool * 500n) / 10000n;
      const expected = [(net * 6000n) / 10000n, (net * 2500n) / 10000n, (net * 1500n) / 10000n];
      expected.push(pool - expected[0] - expected[1] - expected[2]);
      after.forEach((b, i) => assert.equal(b - before[i], expected[i]));
      if (n === 10) assert.deepEqual(expected.slice(0, 3), [parseEther("0.57"), parseEther("0.2375"), parseEther("0.1425")]);
      assert.equal(await pub.getBalance({ address: escrow.address }), 0n);
      await rejects(asOp.write.settleMatch([matchId, [addr(0), addr(1), addr(2)], seed]), "AlreadySettled");
    }).timeout(60000);
  }

  it("refunds only after the timeout, and only once", async () => {
    const { as, join, asOp, addr } = await setup();
    await join(2);
    await rejects((await as(0)).write.refund([matchId]), "RefundNotAvailable");
    await increaseTime(121); // lobby failed: < 3 players after 2 minutes
    await (await as(0)).write.refund([matchId]);
    await rejects((await as(0)).write.refund([matchId]), "RefundNotAvailable");
    await rejects((await as(9)).write.refund([matchId]), "RefundNotAvailable"); // never joined
  }).timeout(60000);

  it("full lobby never settled: refund after 15 minutes and settle closes", async () => {
    const { as, join, asOp, addr } = await setup();
    await join(3);
    await increaseTime(121);
    await rejects((await as(0)).write.refund([matchId]), "RefundNotAvailable"); // 3 players: no lobby refund
    await increaseTime(15 * 60);
    await (await as(2)).write.refund([matchId]);
    await rejects(asOp.write.settleMatch([matchId, [addr(0), addr(1), addr(2)], seed]), "SettleWindowClosed");
  }).timeout(60000);

  it("exposes isPlayer and playerCount for the server", async () => {
    const { escrow, join, addr } = await setup();
    await join(4);
    assert.equal(await escrow.read.isPlayer([matchId, addr(0)]), true);
    assert.equal(await escrow.read.isPlayer([matchId, addr(5)]), false);
    assert.equal(await escrow.read.playerCount([matchId]), 4);
  }).timeout(60000);
});

describe("SkinShop", () => {
  it("sells skins 1-3 at 0.05 MON and withdraws to treasury", async () => {
    const [owner, treasury, buyer] = await hre.viem.getWalletClients();
    const shop = await hre.viem.deployContract("SkinShop", [treasury.account.address, ""]);
    const asBuyer = await hre.viem.getContractAt("SkinShop", shop.address, { client: { wallet: buyer } });
    await asBuyer.write.buySkin([2n], { value: parseEther("0.05") });
    assert.equal(await shop.read.balanceOf([buyer.account.address, 2n]), 1n);
    await rejects(asBuyer.write.buySkin([4n], { value: parseEther("0.05") }), "UnknownSkin");
    await rejects(asBuyer.write.buySkin([1n], { value: parseEther("0.01") }), "WrongPrice");
    const pub = await hre.viem.getPublicClient();
    const before = await pub.getBalance({ address: treasury.account.address });
    await shop.write.withdraw({ account: owner.account });
    assert.equal((await pub.getBalance({ address: treasury.account.address })) - before, parseEther("0.05"));
  }).timeout(60000);
});
