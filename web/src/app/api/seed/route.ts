import { NextResponse } from 'next/server';
import { accountRepo, journalRepo, propertyRepo, categoryRepo } from '@/lib/repos';

export async function POST() {
  try {
    // Create owners
    const emily = await propertyRepo.createOwner('Emily Pun');
    const jono = await propertyRepo.createOwner('Jono Taylor');

    // 20 Denbigh Road
    const denbigh = await propertyRepo.createProperty({
      name: '20 Denbigh Road',
      address: '20 Denbigh Road, London, E6 3LD',
      purchaseDate: '2022-07-08',
      purchasePrice: '440000',
    });

    const denbighCapEmily = await accountRepo.create({
      name: 'Capital - Emily Pun - 20 Denbigh Road',
      accountType: 'EQUITY',
      description: "Emily's capital contributions to 20 Denbigh Road",
    });
    const denbighCapJono = await accountRepo.create({
      name: 'Capital - Jono Taylor - 20 Denbigh Road',
      accountType: 'EQUITY',
      description: "Jono's capital contributions to 20 Denbigh Road",
    });

    await propertyRepo.addOwnership(denbigh.id, emily.id, denbighCapEmily.id);
    await propertyRepo.addOwnership(denbigh.id, jono.id, denbighCapJono.id);

    const equityContra = await accountRepo.create({
      name: 'Property Equity Contributions',
      accountType: 'EQUITY',
      description: 'Contra account for property capital contributions',
    });

    // Emily purchase contribution
    await journalRepo.createEntry(
      { date: '2022-07-08', description: 'Emily - purchase contribution (deposit & costs) - 20 Denbigh Road' },
      [
        { accountId: denbighCapEmily.id, amount: '80784' },
        { accountId: equityContra.id, amount: '-80784' },
      ],
    );

    // Jono purchase contribution
    await journalRepo.createEntry(
      { date: '2022-07-08', description: 'Jono - purchase contribution (deposit & costs) - 20 Denbigh Road' },
      [
        { accountId: denbighCapJono.id, amount: '25466' },
        { accountId: equityContra.id, amount: '-25466' },
      ],
    );

    // Emily renovation
    await journalRepo.createEntry(
      { date: '2023-06-30', description: 'Emily - renovation contributions - 20 Denbigh Road' },
      [
        { accountId: denbighCapEmily.id, amount: '196216' },
        { accountId: equityContra.id, amount: '-196216' },
      ],
    );

    // Jono renovation
    await journalRepo.createEntry(
      { date: '2023-06-30', description: 'Jono - renovation contributions - 20 Denbigh Road' },
      [
        { accountId: denbighCapJono.id, amount: '45000' },
        { accountId: equityContra.id, amount: '-45000' },
      ],
    );

    // Denbigh Mortgage
    const denbighMortgageLiability = await accountRepo.create({
      name: 'Mortgage - Santander - 20 Denbigh Road',
      accountType: 'LIABILITY',
      description: 'Santander mortgage on 20 Denbigh Road',
    });

    const mortgageSetup = await accountRepo.create({
      name: 'Mortgage Setup Equity',
      accountType: 'EQUITY',
      description: 'Contra for initial mortgage setup entries',
    });

    const denbighMortgage = await propertyRepo.createMortgage({
      propertyId: denbigh.id,
      lender: 'Santander',
      originalAmount: '337500',
      startDate: '2022-07-08',
      termMonths: 420,
      liabilityAccountId: denbighMortgageLiability.id,
    });

    await propertyRepo.addMortgageRate(denbighMortgage.id, '2.04', '2022-07-08');
    await propertyRepo.addMortgageRate(denbighMortgage.id, '4.41', '2024-09-07');

    await journalRepo.createEntry(
      { date: '2022-07-08', description: 'Initial mortgage draw - Santander - 20 Denbigh Road' },
      [
        { accountId: denbighMortgageLiability.id, amount: '-337500' },
        { accountId: mortgageSetup.id, amount: '337500' },
      ],
    );

    await journalRepo.createEntry(
      { date: '2024-09-07', description: 'Principal repayment to date - Santander - 20 Denbigh Road' },
      [
        { accountId: denbighMortgageLiability.id, amount: '2264' },
        { accountId: mortgageSetup.id, amount: '-2264' },
      ],
    );

    // Denbigh valuations
    await propertyRepo.addValuation(denbigh.id, '450000', '2022-07-08', 'Santander mortgage valuation');
    await propertyRepo.addValuation(denbigh.id, '440000', '2022-07-08', 'Purchase price');
    await propertyRepo.addValuation(denbigh.id, '685000', '2024-09-07', 'Purchase + renovation cost basis');

    // Allocation rules
    await propertyRepo.setAllocationRule(denbigh.id, emily.id, '65.08', 'all');
    await propertyRepo.setAllocationRule(denbigh.id, jono.id, '34.92', 'all');

    // 249 Francis Road
    const francis = await propertyRepo.createProperty({
      name: '249 Francis Road',
      address: '249 Francis Road, Leyton, London, E10 6NW',
      purchaseDate: '2019-10-28',
      purchasePrice: '435000',
    });

    const francisCapEmily = await accountRepo.create({
      name: 'Capital - Emily Pun - 249 Francis Road',
      accountType: 'EQUITY',
      description: "Emily's capital contributions to 249 Francis Road",
    });
    const francisCapJono = await accountRepo.create({
      name: 'Capital - Jono Taylor - 249 Francis Road',
      accountType: 'EQUITY',
      description: "Jono's capital contributions to 249 Francis Road",
    });

    await propertyRepo.addOwnership(francis.id, emily.id, francisCapEmily.id);
    await propertyRepo.addOwnership(francis.id, jono.id, francisCapJono.id);

    // Emily deposit
    await journalRepo.createEntry(
      { date: '2019-10-28', description: 'Emily - deposit contribution - 249 Francis Road' },
      [
        { accountId: francisCapEmily.id, amount: '130000' },
        { accountId: equityContra.id, amount: '-130000' },
      ],
    );

    // Emily costs
    await journalRepo.createEntry(
      { date: '2019-10-28', description: 'Emily - purchase costs contribution - 249 Francis Road' },
      [
        { accountId: francisCapEmily.id, amount: '11800' },
        { accountId: equityContra.id, amount: '-11800' },
      ],
    );

    // Principal payments shared
    await journalRepo.createEntry(
      { date: '2022-07-08', description: 'Jono - share of mortgage principal paid (Oct 2019-Jul 2022) - 249 Francis Road' },
      [
        { accountId: francisCapJono.id, amount: '16252' },
        { accountId: equityContra.id, amount: '-16252' },
      ],
    );
    await journalRepo.createEntry(
      { date: '2022-07-08', description: 'Emily - share of mortgage principal paid (Oct 2019-Jul 2022) - 249 Francis Road' },
      [
        { accountId: francisCapEmily.id, amount: '16252' },
        { accountId: equityContra.id, amount: '-16252' },
      ],
    );

    // Francis mortgage
    const francisMortgageLiability = await accountRepo.create({
      name: 'Mortgage - Hinckley & Rugby - 249 Francis Road',
      accountType: 'LIABILITY',
      description: 'H&R Building Society BTL mortgage on 249 Francis Road',
    });

    const francisMortgage = await propertyRepo.createMortgage({
      propertyId: francis.id,
      lender: 'Hinckley & Rugby Building Society',
      originalAmount: '337500',
      startDate: '2022-06-22',
      termMonths: 420,
      liabilityAccountId: francisMortgageLiability.id,
    });

    await propertyRepo.addMortgageRate(francisMortgage.id, '2.60', '2022-06-22');
    await propertyRepo.addMortgageRate(francisMortgage.id, '6.25', '2024-07-03');

    await journalRepo.createEntry(
      { date: '2022-06-22', description: 'Initial mortgage draw - Hinckley & Rugby - 249 Francis Road' },
      [
        { accountId: francisMortgageLiability.id, amount: '-337500' },
        { accountId: mortgageSetup.id, amount: '337500' },
      ],
    );

    await journalRepo.createEntry(
      { date: '2024-07-03', description: 'Principal repayment to date - H&R - 249 Francis Road' },
      [
        { accountId: francisMortgageLiability.id, amount: '11584' },
        { accountId: mortgageSetup.id, amount: '-11584' },
      ],
    );

    await journalRepo.createEntry(
      { date: '2024-07-03', description: 'Emily - mortgage principal (2022-2024) - 249 Francis Road' },
      [
        { accountId: francisCapEmily.id, amount: '5792' },
        { accountId: equityContra.id, amount: '-5792' },
      ],
    );
    await journalRepo.createEntry(
      { date: '2024-07-03', description: 'Jono - mortgage principal (2022-2024) - 249 Francis Road' },
      [
        { accountId: francisCapJono.id, amount: '5792' },
        { accountId: equityContra.id, amount: '-5792' },
      ],
    );

    // Francis valuations
    await propertyRepo.addValuation(francis.id, '435000', '2019-10-28', 'Purchase price');
    await propertyRepo.addValuation(francis.id, '450000', '2022-06-22', 'H&R mortgage valuation');
    await propertyRepo.addValuation(francis.id, '450000', '2024-07-03', 'H&R assumed valuation');

    // Francis allocation rules
    await propertyRepo.setAllocationRule(francis.id, emily.id, '50.0', 'all');
    await propertyRepo.setAllocationRule(francis.id, jono.id, '50.0', 'all');

    // Additional categories
    const extraCategories = [
      'Mortgage Interest', 'Property Insurance', 'Property Maintenance',
      'Renovation', 'Solicitor Fees', 'Stamp Duty', 'Rental Income', 'Mortgage Payment',
    ];
    for (const name of extraCategories) {
      try { await categoryRepo.create({ name }); } catch { /* ignore duplicates */ }
    }

    return NextResponse.json({ success: true, message: 'Database seeded successfully' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Seed failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
