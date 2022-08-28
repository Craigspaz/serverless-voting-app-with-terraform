import { browser } from '$app/env';
import { writable } from 'svelte/store';
import * as AWSCognitoIdentity from '@aws-sdk/client-cognito-identity';
import { getIoTClient } from '$lib/aws-iot/client';

let iot_client;

const IOT_TOPIC = 'votes';

export const pets = writable([
	{ id: 'dog', votes: 0, img_url: 'images/dog.jpg', order: 1 },
	{ id: 'cat', votes: 0, img_url: 'images/cat.jpg', order: 2 },
	{ id: 'bird', votes: 0, img_url: 'images/bird.jpg', order: 3 }
]);

export const options = writable((browser && JSON.parse(localStorage.getItem('options'))) || {});

if (browser) {
	options.subscribe((value) => {
		console.log('Options updated. Saving to browser local storage.');
		localStorage.options = JSON.stringify(value);
	});

	load_data();
}

async function getCredentions(cognito_identity_pool_id) {
	const aws_region = cognito_identity_pool_id.split(':')[0];
	const cognito_client = new AWSCognitoIdentity.CognitoIdentity({ region: aws_region });

	const res = await cognito_client.getId({ IdentityPoolId: cognito_identity_pool_id });
	const creds = await cognito_client.getCredentialsForIdentity({ IdentityId: res.IdentityId });

	return creds.Credentials;
}

export async function load_data() {
	const options = JSON.parse(localStorage.getItem('options'));

	// load current votes from api gateway
	if (options && options.apigw_endpoint) {
		console.log(`load votes from voting-service: ${options.apigw_endpoint}${IOT_TOPIC}`);
		const res = await fetch(`${options.apigw_endpoint}${IOT_TOPIC}`);
		console.log(res);
		if (res.ok) {
			const data = await res.json();
			const votes = data.map((vote) => {
				return { id: vote.PK, votes: vote.votes, img_url: vote.img_url };
			});
			console.log(`votes=${JSON.stringify(votes)}`);
			pets.set(votes);
		} else {
			console.error(`failed to fetch votes from api: ${options.apigw_endpoint}`);
		}
	}

	// setup iot client to receive realtime updates
	if (options && options.cognito_identity_pool_id && options.iotcore_endpoint) {
		const aws_region = options.cognito_identity_pool_id.split(':')[0];
		const creds = await getCredentions(options.cognito_identity_pool_id);

		if (iot_client) {
			iot_client.end();
		}

		iot_client = await getIoTClient(options.iotcore_endpoint, aws_region, creds);

		iot_client.on('connect', function () {
			iot_client.subscribe(IOT_TOPIC, function (err) {
				if (!err) {
					console.log(
						`subscribed to 'votes' topic at IoT endpoint '${options.iotcore_endpoint}' with Cognito Identiy Pool ID '${options.cognito_identity_pool_id}' `
					);
				}
			});
		});

		iot_client.on('message', function (topic, message) {
			// message is Buffer
			console.log(message.toString());

			const pet_updates = JSON.parse(message.toString());

			pets.update((current) => {
				const pets_index = {};
				current.forEach((pet) => {
					pets_index[pet.id] = pet;
				});

				pet_updates.forEach((pet_update) => {
					pets_index[pet_update.id].votes = parseInt(pet_update.votes);
				});

				const new_pets = Object.entries(pets_index).map((p) => p[1]);
				return new_pets;
			});
		});
	}
}

export async function save_vote(vote) {
	const options = JSON.parse(localStorage.getItem('options'));

	if (options && options.apigw_endpoint) {
		console.log(`send vote to voting-api: ${JSON.stringify(vote)}`);

		const res = await fetch(`${options.apigw_endpoint}${IOT_TOPIC}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ id: vote.id })
		});
		const data = await res.json();
		return data;
	}

	return null;
}
