== React forms without hassle ==

## Example

```typescript
const form = useForm(
  {
    id: "",
    name: "",
    description: "",
    children: [{ name: "" }]
  },
  {
    fieldValidation: {
      id: id => (!id ? "Id is an required field" : undefined),
      children: {
        name: name => (!name ? "Name is required" : undefined)
      }
    },
    submit: values => createWithApi({ input: stripCreateVendorInput(values) })
  }
);

return (
  <form>
    <MyTextComponent field={form.fields.id} />
    <MyTextComponent field={form.fields.name} />
    <MyTextComponent field={form.fields.description} />
    <MyChildrenComponent field={form.fields.children} />
  </form>
);
```

## API reference

TODO when interface is stable

## Notable features

- Async field level validation

## Limitations and todos

- Lodash is required (should probably be removed, most its mapValues that is used)
- No form level validation (should be implemented when needed)
- No opiniated way of doing validation (could perhaps support yoi out of the box but without a dependency)
- Arrays must not be used as tuples (same type is assumed on all indexes)
- No debouncing on async validation (should probably be implemented)
- No cancelation of async validation
- Only basic array manipulation supported (push and remove) (implement more when needed)
- No pre-bundled helper components to render fields (formik has it, but it may not be needed)
