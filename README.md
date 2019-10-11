# React forms without hassle

## A Simple Form

```tsx
const MyTextComponent = ({ field, ...innerProps }) => {
  return (
    <Input
      value={field.value}
      {...field.props}
      {...innerProps}
      className={field.error && field.touched ? "error" : ""}
    />
  );
};

const FormComponent = () => {
  const form = useForm(
    {
      id: "",
      name: "",
      description: "",
    },
    {
      fieldValidation: {
        id: id => (!id ? "Id is an required field" : undefined),
      },
      submit: values => doSomething(values),
    },
  );

  return (
    <form>
      <MyTextComponent field={form.fields.id} />
      <MyTextComponent field={form.fields.name} />
      <MyTextComponent field={form.fields.description} />
    </form>
  );
};
```

## Adding a complex object Example

```tsx

const MyChildrenComponent = ({ complexField }) => {

  return (
    <div>
      <MyTextComponent field={complexField.foo} />
      <MyTextComponent field={complexField.bar} />
      <MyTextComponent field={complexField.baz} />
    </div>
  );
};

const FormComponent = () => {
  const form = useForm(
    {
      id: "",
      name: "",
      description: "",
      extraInfo: null
    },
    {
      fieldValidation: {
        id: id => (!id ? "Id is an required field" : undefined),
        extraInfo: {
          value: {
            foo: value => (!value ? "foo is required" : undefined),
          }
          validate: (values => (!values.bar && !values.baz ? "You need to specify either bar or baz": undefined))
        },
      },
      submit: values => doSomething(values),
    },
  );

  const addExtraInfo = (e) => {
    e.preventDefault();
    form.fields.extraInfo.set({ foo: "", bar: "", baz: "" });
  }

  return (
    <form>
      <MyTextComponent field={form.fields.id} />
      <MyTextComponent field={form.fields.name} />
      <MyTextComponent field={form.fields.description} />
      { form.fields.extraInfo.value
        ? <MyChildrenComponent field={form.fields.extraInfo.value} />
        : <button onClick={addExtraInfo}>Add Extra Info</button>
      }
    </form>
  );
};

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
- No pre-bundled helper components to render validation errors (formik has it, but it may not be needed)
```
