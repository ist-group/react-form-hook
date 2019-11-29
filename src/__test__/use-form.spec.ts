// tslint:disable-next-line: no-implicit-dependencies
import { renderHook, act } from "@testing-library/react-hooks";
import { useForm } from "../index";

interface Item {
  id: string;
  name: string | null;
  description?: string;
  date: Date;
}

interface FormProps extends Item {
  list: Item[];
  item?: Item | null;
}

const initValue = {
  id: "",
  name: "",
  description: "",
  list: [
    { id: "", name: "", description: "", date: new Date() },
    { id: "2", name: "Test 2", description: "", date: new Date() },
  ],
  item: { id: "", name: "", description: "", date: new Date() },
  date: new Date(),
};

const getBasicFormSetup = (myMock?: jest.Mock<any, any>) =>
  renderHook(() =>
    useForm<FormProps>(initValue, {
      validation: {
        fields: {
          id: {
            onSubmit: value => !value && "Id is required",
          },
          list: {
            item: {
              fields: {
                id: {
                  onSubmit: value => !value && "Id is required",
                },
              },
              onSubmit: value => !value.name && !value.description && "Either name or description is required",
            },
            onChange: list => list.length > 10 && "You can max have 10 list",
            onSubmit: list => list.length === 2 && "Two items is not allowed",
          },
          item: {
            fields: {
              id: {
                onChange: value => !value && "Id is required",
              },
            },
            onSubmit: value => value && !value.name && !value.description && "Either name or description is required",
          },
        },
      },
      onSubmit: value => {
        if (myMock) {
          return myMock(value);
        }
      },
    }),
  );

test("initial value", () => {
  const { result } = getBasicFormSetup();

  const date = new Date();

  act(() => {
    result.current.fields.id.set("test");
    result.current.fields.name.set("test2");
    result.current.fields.description!.set("test3");
    result.current.fields.date.set(date);
  });

  expect(result.current.fields.id.value).toBe("test");
  expect(result.current.fields.name.value).toBe("test2");
  expect(result.current.fields.description!.value).toBe("test3");
  expect(result.current.fields.date.value.toISOString()).toBe(date.toISOString());
});

test("Arrays - push", () => {
  const { result } = getBasicFormSetup();

  expect(result.current.fields.list).toBeDefined();

  expect(result.current.fields.list.touched).toBe(false);
  const date = new Date();
  act(() => {
    result.current.fields.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
  });
  expect(result.current.fields.list.touched).toBe(true);
  expect(result.current.fields.list.items[1].touched).toBe(false);

  expect(result.current.fields.list.items.length).toBe(3);
  expect(result.current.fields.list.items[2].fields.id.value).toBe("id-test");
  expect(result.current.fields.list.items[2].fields.name.value).toBe("name-test");
  expect(result.current.fields.list.items[2].fields.description!.value).toBe("description-test");
  expect(result.current.fields.list.items[2].fields.date!.value.toISOString()).toBe(date.toISOString());
});

test("Arrays -  onChange validation", () => {
  const { result } = getBasicFormSetup();

  const date = new Date();
  act(() => {
    result.current.fields.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
    result.current.fields.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
    result.current.fields.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
    result.current.fields.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
    result.current.fields.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
    result.current.fields.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
    result.current.fields.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
    result.current.fields.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
  });
  expect(result.current.fields.list.error).toBeFalsy();
  act(() => {
    result.current.fields.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
  });
  expect(result.current.fields.list.error).toBe("You can max have 10 list");
});

test("onSubmit", async () => {
  const myMock = jest.fn(() => 0 / 0);
  const { result, waitForNextUpdate } = getBasicFormSetup(myMock);

  expect(result.current.fields.list.error).toBeFalsy();
  expect(result.current.fields.list.items[0].fields.id.error).toBeFalsy();
  expect(result.current.fields.list.items[0].error).toBeFalsy();
  expect(result.current.fields.item!.fields!.id.error).toBeFalsy();
  expect(result.current.fields.item!.error).toBeFalsy();

  await act(async () => {
    const date = new Date();
    result.current.fields.list.remove(0);
    result.current.fields.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
    result.current.fields.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
    result.current.fields.item!.fields!.id.set("ok");
    result.current.fields.item!.fields!.name.set("ok");
    result.current.fields.item!.fields!.description!.set("ok");
    result.current.fields.id.set("ok");
    result.current.fields.name.set("ok");
    result.current.fields.description!.set("ok");
  });

  await act(async () => {
    result.current.submit();
  });

  expect(myMock).toBeCalled();
  expect(result.current.fields.id.value).toBe("ok");
  expect(result.current.fields.id.error).toBeFalsy();
  expect(result.current.fields.list.error).toBeFalsy();
  expect(result.current.fields.item!.fields!.id.error).toBeFalsy();
  expect(result.current.fields.item!.error).toBeFalsy();
  expect(result.current.fields.list.items[0].error).toBeFalsy();
  expect(result.current.fields.list.items[0].fields.id.error).toBeFalsy();
});

test("onSubmit executing", async () => {
  const myMock = jest.fn(() => new Promise(() => {}));
  const { result } = getBasicFormSetup(myMock);

  await act(async () => {
    const date = new Date();
    const newDate = new Date("2019-01-01");
    result.current.fields.list.remove(0);
    result.current.fields.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
    result.current.fields.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
    result.current.fields.item!.fields!.id.set("ok");
    result.current.fields.item!.fields!.name.set("ok");
    result.current.fields.item!.fields!.description!.set("ok");
    result.current.fields.id.set("ok");
    result.current.fields.name.set("ok");
    result.current.fields.description!.set("ok");
    result.current.fields.date.set(newDate);
  });

  await act(async () => {
    result.current.submit();
  });

  expect(result.current.submitting).toBeTruthy();
  expect(result.current.disabled).toBeTruthy();
  expect(result.current.touched).toBeTruthy();
  expect(result.current.fields.id.disabled).toBeTruthy();
  expect(result.current.fields.id.touched).toBeTruthy();
});

test("onSubmit validation", async () => {
  const myMock = jest.fn();
  const { result, waitForNextUpdate } = getBasicFormSetup(myMock);

  await act(async () => {
    result.current.submit();
  });

  expect(myMock.mock.calls.length).toBe(0);
  expect(result.current.fields.id.value).toBe("");
  expect(result.current.fields.id.error).toBe("Id is required");
  expect(result.current.fields.list.error).toBe("Two items is not allowed");
  expect(result.current.fields.item!.fields!.id.error).toBe("Id is required");
  expect(result.current.fields.item!.error).toBe("Either name or description is required");
  expect(result.current.fields.list.items[0].error).toBe("Either name or description is required");
  expect(result.current.fields.list.items[0].fields.id.error).toBe("Id is required");
});

test("Arrays - remove - touched", () => {
  const { result } = getBasicFormSetup();
  expect(result.current.fields.list.touched).toBe(false);

  act(() => {
    result.current.fields.list.remove(1);
  });
  expect(result.current.fields.list.touched).toBe(true);
  expect(result.current.fields.list.items.length).toBe(1);
});

test("Arrays - remove set bindings", () => {
  const { result } = getBasicFormSetup();

  act(() => {
    result.current.fields.list.push({
      id: "id-test",
      name: "name-test",
      description: "description-test",
      date: new Date(),
    });
    result.current.fields.list.remove(1);
    result.current.fields.list.items[0].fields.name.set("After remove");
  });
  expect(result.current.fields.list.items[0].fields.name.value).toBe("After remove");
  expect(result.current.fields.list.items[1].fields.name.value).toBe("name-test");
  expect(result.current.fields.list.items[0].path).toMatchObject(["list", 0]);
  expect(result.current.fields.list.items[1].path).toMatchObject(["list", 1]);

  expect(result.current.fields.list.items.length).toBe(2);
});

test("Date - date to array and back", () => {
  const { result } = getBasicFormSetup();

  const d1 = new Date("2019-01-01");
  const d2 = new Date("2019-01-02");

  act(() => {
    result.current.fields.date.set(d1);
  });
  expect(result.current.fields.date.value.toISOString()).toBe(d1.toISOString());

  act(() => {
    result.current.fields.date.set([d1, d2]);
  });
  expect(result.current.fields.date.value).toHaveLength(2);
  expect(((result.current.fields.date.value as unknown) as Date[])[0].toISOString()).toBe(d1.toISOString());
  expect(((result.current.fields.date.value as unknown) as Date[])[1].toISOString()).toBe(d2.toISOString());

  act(() => {
    result.current.fields.date.set(d1);
  });
  expect(result.current.fields.date.value.toISOString()).toBe(d1.toISOString());
});

test("value", () => {
  const { result } = getBasicFormSetup();
  expect(result.current.value).toMatchObject(initValue);

  act(() => {
    result.current.fields.description!.set("new description");
    result.current.fields.list!.items[0].fields.description!.set("new description for item");
  });

  expect(result.current.value.description).toBe("new description");
  expect(result.current.value.list[0].description).toBe("new description for item");
});

test("validation closure", () => {
  const { result, rerender } = renderHook(
    (props: { validValue: string }) =>
      useForm<string>("", {
        validation: {
          onChange: val => (val === props.validValue ? undefined : "ERROR"),
        },
        onSubmit: () => {},
      }),
    { initialProps: { validValue: "correct value" } },
  );

  act(() => result.current.set("correct value"));
  expect(result.current.error).toBeFalsy();

  rerender({ validValue: "new correct value" });
  act(() => result.current.set("correct value"));
  expect(result.current.error).toBe("ERROR");
});
