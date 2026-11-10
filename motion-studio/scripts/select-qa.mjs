// Exercise the actual themed menu, including portal menus inside modal dialogs.
export async function selectOption(control, value) {
  await control.click();
  await control.page().getByRole('listbox').waitFor();
  const options = control.page().getByRole('option');
  const count = await options.count();
  for (let index = 0; index < count; index++) {
    const option = options.nth(index);
    if (await option.getAttribute('data-value') === value) {
      await option.click();
      await control.page().getByRole('listbox').waitFor({ state: 'hidden' });
      return;
    }
  }
  throw new Error(`Option not found: ${value}`);
}

export async function optionValues(control) {
  await control.click();
  await control.page().getByRole('listbox').waitFor();
  const options = control.page().getByRole('option');
  const values = await options.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-value')).filter(Boolean));
  await control.press('Escape');
  return values;
}

export async function selectedOptionValue(control) {
  await control.click();
  const selected = control.page().getByRole('option', { selected: true });
  await selected.waitFor();
  const value = await selected.getAttribute('data-value');
  await control.press('Escape');
  return value;
}
